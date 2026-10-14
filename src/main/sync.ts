import { watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CollectionStore } from './storage/collection'
import { writeFileAtomic, isTempName } from './storage/atomic'
import type { LocalProtector } from './crypto/keyring'
import { log } from './log'
import type { ConflictView } from '@shared/maintenance'

/** Una collezione sincronizzata: lo store può non esistere (es. cassaforte chiusa). */
export interface SyncedCollection {
  name: string
  store: () => CollectionStore<object> | null
  /** Titolo leggibile di una voce, per l'elenco dei conflitti. */
  title: (item: Record<string, unknown>) => string
}

interface StoredConflict extends ConflictView {
  data: Record<string, unknown>
}

const RELOAD_DELAY_MS = 1200

/**
 * Sincronizzazione con OneDrive (il trasferimento lo fa il client OneDrive):
 * - un watcher sulla cartella ricarica e unisce le modifiche arrivate dagli altri PC;
 * - le copie di conflitto di OneDrive vengono unite e poi archiviate;
 * - le versioni scartate da modifiche concorrenti restano in un elenco
 *   (cifrato, solo su questo PC) da cui si possono ripristinare.
 */
export class SyncManager {
  private collections = new Map<string, SyncedCollection>()
  private watcher: FSWatcher | null = null
  private timers = new Map<string, NodeJS.Timeout>()
  private conflicts: StoredConflict[] = []
  private listeners = new Set<() => void>()
  lastSync: number | null = null

  constructor(
    private readonly opts: {
      dataDir: string
      localDir: string
      protector: LocalProtector
      onNewConflicts: (list: ConflictView[]) => void
    }
  ) {}

  private get conflictFile() {
    return join(this.opts.localDir, 'conflicts.bin')
  }
  private get archiveDir() {
    return join(this.opts.dataDir, '.archive')
  }

  register(c: SyncedCollection): void {
    this.collections.set(c.name, c)
  }

  async init(): Promise<void> {
    try {
      this.conflicts = JSON.parse(this.opts.protector.unprotect(await readFile(this.conflictFile)).toString('utf8'))
    } catch {
      this.conflicts = []
    }
    // Conflitti trovati durante il primo caricamento.
    for (const c of this.collections.values()) await this.collect(c)
  }

  start(): void {
    try {
      this.watcher = watch(this.opts.dataDir, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const parts = filename.toString().split(sep)
        const name = parts[0]
        const file = parts[parts.length - 1] ?? ''
        if (!name || parts.length < 2 || isTempName(file) || !file.toLowerCase().endsWith('.json')) return
        if (this.collections.has(name)) this.scheduleReload(name)
      })
      this.watcher.on('error', (err) => log.warn('Watcher della cartella dati interrotto', err))
    } catch (err) {
      log.warn('Impossibile osservare la cartella dati', err)
    }
  }

  private scheduleReload(name: string): void {
    const prev = this.timers.get(name)
    if (prev) clearTimeout(prev)
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name)
        void this.reload(name)
      }, RELOAD_DELAY_MS)
    )
  }

  /** Ricarica una collezione (o tutte) unendo i file di tutti i PC. */
  async reload(name?: string): Promise<void> {
    const list = name ? [this.collections.get(name)].filter(Boolean) : [...this.collections.values()]
    for (const c of list as SyncedCollection[]) {
      const store = c.store()
      if (!store) continue
      try {
        await store.load()
        await this.collect(c)
        const archived = await store.archiveConflictCopies(this.archiveDir)
        if (archived.length) log.info(`Copie di conflitto di OneDrive unite e archiviate (${c.name}): ${archived.length}`)
        this.lastSync = Date.now()
      } catch (err) {
        log.warn(`Sincronizzazione di ${c.name} non riuscita`, err)
      }
    }
    this.emit()
  }

  private async collect(c: SyncedCollection): Promise<void> {
    const store = c.store()
    if (!store) return
    const found = store.takeConflicts()
    if (found.length === 0) return
    const added: StoredConflict[] = found.map((f) => ({
      id: randomUUID(),
      collection: c.name,
      itemId: f.id,
      title: c.title(f.discarded as unknown as Record<string, unknown>),
      at: Date.now(),
      discardedAt: f.discarded.updatedAt,
      discardedBy: f.discarded.updatedBy,
      keptAt: f.kept.updatedAt,
      data: f.discarded as unknown as Record<string, unknown>
    }))
    this.conflicts = [...added, ...this.conflicts].slice(0, 200)
    await this.save()
    log.info(`Conflitti rilevati in ${c.name}: ${added.length}`)
    this.opts.onNewConflicts(added.map(view))
    this.emit()
  }

  list(): ConflictView[] {
    return this.conflicts.map(view)
  }

  /** Ripristina la versione scartata (diventa la modifica più recente) oppure la ignora. */
  async resolve(id: string, action: 'restore' | 'dismiss'): Promise<boolean> {
    const c = this.conflicts.find((x) => x.id === id)
    if (!c) return false
    if (action === 'restore') {
      const store = this.collections.get(c.collection)?.store()
      if (!store) return false
      const { id: _i, createdAt: _c, updatedAt: _u, updatedBy: _b, rev: _r, hist: _h, deletedAt: _d, ...fields } = c.data
      store.restore({ ...(fields as object), id: c.itemId })
    }
    this.conflicts = this.conflicts.filter((x) => x.id !== id)
    await this.save()
    this.emit()
    return true
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }

  private async save(): Promise<void> {
    await writeFileAtomic(this.conflictFile, this.opts.protector.protect(Buffer.from(JSON.stringify(this.conflicts), 'utf8')))
  }

  dispose(): void {
    this.watcher?.close()
    for (const t of this.timers.values()) clearTimeout(t)
  }
}

function view(c: StoredConflict): ConflictView {
  const { data: _d, ...rest } = c
  return rest
}
