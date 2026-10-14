import { mkdir, readdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { writeFileAtomic, isTempName } from './atomic'
import { mergeItems, nextRevision, tombstone, type MergeConflict, type SyncItem } from '@shared/sync'

/**
 * Collezione di voci sincronizzate. Ogni PC scrive SOLO il proprio file
 * (`<cartella>/<deviceId>.json`) e legge quelli di tutti: OneDrive non deve mai
 * unire due scritture sullo stesso file, quindi i conflitti di OneDrive
 * diventano rarissimi. Se capitano lo stesso (copie `nome-PC.json`), quei file
 * vengono letti e uniti come gli altri.
 */

export interface DeviceInfo {
  id: string
  name: string
}

/** Trasforma il contenuto prima della scrittura (es. cifratura, dalla milestone 4). */
export interface Codec {
  encode(plain: string): Promise<string> | string
  decode(stored: string): Promise<string> | string
}

export const plainCodec: Codec = { encode: (s) => s, decode: (s) => s }

const FILE_FORMAT = 'dock-collection'
const FILE_VERSION = 1

const metaSchema = z
  .object({
    id: z.string().min(1).max(200),
    createdAt: z.number(),
    updatedAt: z.number(),
    updatedBy: z.string(),
    rev: z.string(),
    hist: z.array(z.string()),
    deletedAt: z.number().nullable().optional()
  })
  .passthrough()

const fileSchema = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.number(),
  collection: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  writtenAt: z.number(),
  items: z.array(z.unknown())
})

export interface CollectionOptions<T> {
  dir: string
  name: string
  device: DeviceInfo
  /** Validazione dei campi propri della voce (oltre ai metadati). */
  schema: z.ZodType<T>
  codec?: Codec
  now?: () => number
  saveDelayMs?: number
  onError?: (err: unknown, file?: string) => void
}

export class CollectionStore<T extends object> {
  private items = new Map<string, SyncItem<T>>()
  private listeners = new Set<() => void>()
  private saveTimer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private pendingConflicts: MergeConflict<T>[] = []
  private readonly codec: Codec
  private readonly now: () => number

  constructor(private readonly opts: CollectionOptions<T>) {
    this.codec = opts.codec ?? plainCodec
    this.now = opts.now ?? Date.now
  }

  get ownFile(): string {
    return join(this.opts.dir, `${this.opts.device.id}.json`)
  }

  get name(): string {
    return this.opts.name
  }

  get dir(): string {
    return this.opts.dir
  }

  /**
   * Copie di conflitto del NOSTRO file create da OneDrive (es. "<id>-PORTATILE.json"):
   * dopo averle unite e riscritto il nostro file, si spostano in un archivio
   * (mai cancellate) così non si accumulano.
   */
  async archiveConflictCopies(archiveDir: string): Promise<string[]> {
    let names: string[] = []
    try {
      names = await readdir(this.opts.dir)
    } catch {
      return []
    }
    const own = `${this.opts.device.id}.json`
    const copies = names.filter((n) => n !== own && n.startsWith(`${this.opts.device.id}-`) && n.toLowerCase().endsWith('.json'))
    if (copies.length === 0) return []
    await this.flush()
    const target = join(archiveDir, this.opts.name)
    await mkdir(target, { recursive: true })
    for (const name of copies) {
      await rename(join(this.opts.dir, name), join(target, `${Date.now()}-${name}`)).catch(() => undefined)
    }
    return copies
  }

  /** Ripristina una versione (es. quella scartata in un conflitto) come nuova modifica. */
  restore(data: T & { id: string }): SyncItem<T> {
    return this.put(data)
  }

  /** Legge tutti i file della cartella e li unisce a quanto già in memoria. */
  async load(): Promise<void> {
    const lists: SyncItem<T>[][] = [[...this.items.values()]]
    let names: string[] = []
    try {
      names = await readdir(this.opts.dir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.json') || isTempName(name)) continue
      const file = join(this.opts.dir, name)
      try {
        lists.push(await this.readFileItems(file))
      } catch (err) {
        // Un file illeggibile non viene mai cancellato: lo segnaliamo e andiamo avanti.
        this.opts.onError?.(err, file)
      }
    }
    const before = this.snapshotKey()
    const { items, conflicts } = mergeItems(...lists)
    this.items = items
    this.pendingConflicts.push(...conflicts)
    if (this.snapshotKey() !== before) this.emit()
  }

  private async readFileItems(file: string): Promise<SyncItem<T>[]> {
    const raw = await readFile(file, 'utf8')
    const parsed = fileSchema.parse(JSON.parse(await this.codec.decode(raw)))
    const out: SyncItem<T>[] = []
    for (const candidate of parsed.items) {
      const meta = metaSchema.safeParse(candidate)
      if (!meta.success) continue
      if (meta.data.deletedAt == null && !this.opts.schema.safeParse(candidate).success) continue
      out.push(candidate as SyncItem<T>)
    }
    return out
  }

  /** Voci attive (non eliminate). */
  list(): SyncItem<T>[] {
    return [...this.items.values()].filter((i) => i.deletedAt == null)
  }

  get(id: string): SyncItem<T> | undefined {
    const item = this.items.get(id)
    return item && item.deletedAt == null ? item : undefined
  }

  /** Crea o aggiorna una voce. Senza `id` ne genera uno nuovo. */
  put(data: T & { id?: string }): SyncItem<T> {
    const id = data.id ?? randomUUID()
    const clean = this.opts.schema.parse(stripMeta(data)) as T
    const item = nextRevision(this.items.get(id), { ...clean, id }, this.ctx())
    this.items.set(id, item)
    this.changed()
    return item
  }

  remove(id: string): boolean {
    const prev = this.items.get(id)
    if (!prev || prev.deletedAt != null) return false
    this.items.set(id, tombstone(prev, this.ctx()))
    this.changed()
    return true
  }

  /** Conflitti trovati dall'ultima lettura: il chiamante li mostra o li archivia. */
  takeConflicts(): MergeConflict<T>[] {
    const out = this.pendingConflicts
    this.pendingConflicts = []
    return out
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Scrive subito il proprio file (incluse le lapidi). */
  flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const items = [...this.items.values()]
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        const body = {
          format: FILE_FORMAT,
          version: FILE_VERSION,
          collection: this.opts.name,
          deviceId: this.opts.device.id,
          deviceName: this.opts.device.name,
          writtenAt: this.now(),
          items
        }
        await writeFileAtomic(this.ownFile, await this.codec.encode(JSON.stringify(body, null, 1)))
      })
    return this.writing
  }

  private changed(): void {
    this.emit()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.flush().catch((err) => this.opts.onError?.(err, this.ownFile))
    }, this.opts.saveDelayMs ?? 300)
  }

  private ctx() {
    return { deviceId: this.opts.device.id, now: this.now(), rev: randomUUID() }
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }

  private snapshotKey(): string {
    return [...this.items.values()]
      .map((i) => i.rev)
      .sort()
      .join(',')
  }
}

function stripMeta<T extends object>(data: T): T {
  const { id: _id, createdAt: _c, updatedAt: _u, updatedBy: _b, rev: _r, hist: _h, deletedAt: _d, ...rest } =
    data as Record<string, unknown>
  return rest as T
}
