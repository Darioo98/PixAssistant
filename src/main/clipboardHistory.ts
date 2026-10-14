import { ClipboardItem, clipboard, nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './storage/atomic'
import type { LocalProtector } from './crypto/keyring'
import type { NativeEvent, PixNative } from './native/pixNative'
import { log } from './log'
import { addClip, isExcludedApp, type ClipEntry, type ClipOp, type ClipState } from '@shared/extras'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const THUMB_SIZE = 96
const OWN_PROCESSES = ['dock.exe', 'electron.exe']

/**
 * Cronologia appunti: solo su questo PC, cifrata con DPAPI. Ascolta i cambi
 * tramite l'helper nativo (nessun polling) e ignora:
 * - i contenuti marcati come sensibili (password della cassaforte, password manager);
 * - le app escluse nelle impostazioni;
 * - le copie fatte da Dock stesso;
 * - tutto, mentre è in pausa.
 */
export class ClipboardHistory {
  private entries: ClipEntry[] = []
  private saving: Promise<void> = Promise.resolve()
  private listeners = new Set<() => void>()
  private started = false

  constructor(
    private readonly opts: {
      localDir: string
      native: PixNative
      protector: LocalProtector
      settings: () => { max: number; paused: boolean; excluded: string; images: boolean }
      setPaused: (paused: boolean) => void
    }
  ) {}

  private get dir() {
    return join(this.opts.localDir, 'clipboard')
  }
  private get indexFile() {
    return join(this.dir, 'history.bin')
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    try {
      const raw = this.opts.protector.unprotect(await readFile(this.indexFile)).toString('utf8')
      const parsed = JSON.parse(raw) as ClipEntry[]
      if (Array.isArray(parsed)) this.entries = parsed
    } catch {
      this.entries = []
    }
    if (!this.opts.native.available) return
    this.opts.native.onEvent((ev) => void this.onNativeEvent(ev))
    await this.watch()
  }

  /** (Ri)avvia l'ascolto: va richiamato se l'helper nativo si riavvia. */
  async watch(): Promise<void> {
    try {
      await this.opts.native.call('clipboardWatch')
      this.started = true
    } catch (err) {
      log.warn('Ascolto appunti non avviato', err)
    }
  }

  state(): ClipState {
    return { available: this.started, paused: this.opts.settings().paused, entries: this.entries }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private async onNativeEvent(ev: NativeEvent): Promise<void> {
    if (ev.event === 'exit') {
      this.started = false
      setTimeout(() => void this.watch(), 2000)
      return
    }
    if (ev.event !== 'clipboard') return
    const s = this.opts.settings()
    const owner = String(ev.owner ?? '').toLowerCase()
    if (s.paused || ev.sensitive === true) return
    if (OWN_PROCESSES.includes(owner) || isExcludedApp(owner, s.excluded)) return

    const items = await clipboard.read()
    const types = items.flatMap((i) => i.types)
    const base = { id: randomUUID(), source: owner, at: Date.now(), pinned: false }
    if (types.includes('text/plain')) {
      const text = await clipboard.readText()
      if (!text.trim() || text.length > 100_000) return
      this.add({ ...base, kind: 'text', text })
      return
    }
    const imageItem = items.find((i) => i.types.includes('image/png'))
    if (s.images && imageItem) {
      const blob = await imageItem.getType('image/png')
      if (!(blob instanceof Blob) || blob.size > MAX_IMAGE_BYTES) return
      const png = Buffer.from(await blob.arrayBuffer())
      const image = nativeImage.createFromBuffer(png)
      if (image.isEmpty()) return
      const { width, height } = image.getSize()
      const thumb = image.resize(width >= height ? { width: THUMB_SIZE } : { height: THUMB_SIZE }).toDataURL()
      await writeFileAtomic(join(this.dir, `${base.id}.bin`), this.opts.protector.protect(png))
      this.add({ ...base, kind: 'image', thumb, width, height })
    }
  }

  private add(entry: ClipEntry): void {
    const { entries, removed } = addClip(this.entries, entry, this.opts.settings().max)
    this.entries = entries
    for (const r of removed) if (r.kind === 'image') void rm(join(this.dir, `${r.id}.bin`), { force: true })
    this.changed()
  }

  async apply(op: ClipOp): Promise<boolean> {
    switch (op.op) {
      case 'copy': {
        const e = this.entries.find((x) => x.id === op.id)
        if (!e) return false
        if (e.kind === 'text' && e.text !== undefined) await clipboard.writeText(e.text)
        else {
          const png = this.opts.protector.unprotect(await readFile(join(this.dir, `${e.id}.bin`)))
          await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
        }
        // La copia da Dock non crea un duplicato: la voce torna in cima.
        this.entries = [{ ...e, at: Date.now() }, ...this.entries.filter((x) => x.id !== e.id)]
        this.changed()
        return true
      }
      case 'pin':
        this.entries = this.entries.map((x) => (x.id === op.id ? { ...x, pinned: op.pinned } : x))
        this.changed()
        return true
      case 'remove': {
        const e = this.entries.find((x) => x.id === op.id)
        this.entries = this.entries.filter((x) => x.id !== op.id)
        if (e?.kind === 'image') await rm(join(this.dir, `${e.id}.bin`), { force: true })
        this.changed()
        return true
      }
      case 'clear': {
        // "Svuota tutto" tiene le voci fissate.
        const removed = this.entries.filter((x) => !x.pinned)
        this.entries = this.entries.filter((x) => x.pinned)
        for (const r of removed) if (r.kind === 'image') await rm(join(this.dir, `${r.id}.bin`), { force: true })
        this.changed()
        return true
      }
      case 'pause':
        this.opts.setPaused(op.paused)
        return true
    }
  }

  private changed(): void {
    const snapshot = JSON.stringify(this.entries)
    this.saving = this.saving
      .then(() => writeFileAtomic(this.indexFile, this.opts.protector.protect(Buffer.from(snapshot, 'utf8'))))
      .catch((err) => log.warn('Salvataggio cronologia appunti non riuscito', err))
    for (const cb of this.listeners) cb()
  }

  notify(): void {
    for (const cb of this.listeners) cb()
  }

  flush(): Promise<void> {
    return this.saving
  }
}
