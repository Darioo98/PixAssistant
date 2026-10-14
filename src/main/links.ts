import { app, dialog, net, shell, type BrowserWindow } from 'electron'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CollectionStore, type Codec, type DeviceInfo } from './storage/collection'
import { readJson, writeJson } from './storage/localJson'
import { log } from './log'
import { linkSchema, normalizeUrl, type Link, type LinkOp, type LinkView } from '@shared/extras'

const FAVICON_TIMEOUT_MS = 6000
const MAX_FAVICON_BYTES = 200_000

/**
 * Link e app rapide (sincronizzati). Le icone restano solo in cache locale:
 * - siti: la favicon scaricata dal sito stesso (nessun servizio di terzi);
 * - programmi e cartelle: l'icona di Windows, letta in locale.
 */
export class LinksService {
  readonly store: CollectionStore<Link>
  private icons: Record<string, string> = {}
  private pending = new Set<string>()

  constructor(
    private readonly opts: {
      dataDir: string
      localDir: string
      device: DeviceInfo
      codec: Codec
      onError: (err: unknown, file?: string) => void
      window: () => BrowserWindow
      /** Durante una finestra di sistema il pannello non deve chiudersi. */
      holdOpen: (hold: boolean) => void
      onIcons: () => void
    }
  ) {
    this.store = new CollectionStore<Link>({
      dir: join(opts.dataDir, 'links'),
      name: 'links',
      device: opts.device,
      schema: linkSchema,
      codec: opts.codec,
      onError: opts.onError
    })
  }

  private get iconFile() {
    return join(this.opts.localDir, 'link-icons.json')
  }

  async load(): Promise<void> {
    this.icons = await readJson<Record<string, string>>(this.iconFile, {})
    await this.store.load()
  }

  list(): LinkView[] {
    const items = this.store.list().sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    for (const l of items) if (!this.icons[iconKey(l)]) void this.fetchIcon(l)
    return items.map((l) => ({ ...l, icon: this.icons[iconKey(l)] }))
  }

  async apply(op: LinkOp): Promise<{ ok: boolean; value?: string }> {
    switch (op.op) {
      case 'save': {
        let target = op.target
        if (op.kind === 'web') {
          const url = normalizeUrl(op.target)
          if (!url) return { ok: false, value: 'invalid-url' }
          target = url
        }
        const prev = op.id ? this.store.get(op.id) : undefined
        const order = prev?.order ?? Math.max(0, ...this.store.list().map((l) => l.order)) + 1
        const title = op.title || defaultTitle(op.kind, target)
        this.store.put({ kind: op.kind, title, target, order, id: op.id })
        return { ok: true }
      }
      case 'remove':
        return { ok: this.store.remove(op.id) }
      case 'reorder':
        op.ids.forEach((id, i) => {
          const l = this.store.get(id)
          if (l && l.order !== i) this.store.put({ kind: l.kind, title: l.title, target: l.target, order: i, id })
        })
        return { ok: true }
      case 'open': {
        const l = this.store.get(op.id)
        if (!l) return { ok: false }
        if (l.kind === 'web') {
          const url = normalizeUrl(l.target)
          if (!url) return { ok: false }
          await shell.openExternal(url)
          return { ok: true }
        }
        const err = await shell.openPath(l.target)
        return err ? { ok: false, value: 'not-found' } : { ok: true }
      }
      case 'pick': {
        this.opts.holdOpen(true)
        try {
          const res = await dialog.showOpenDialog(this.opts.window(), {
            properties: op.kind === 'folder' ? ['openDirectory'] : ['openFile'],
            filters: op.kind === 'app' ? [{ name: 'Programmi', extensions: ['exe', 'lnk', 'bat', 'cmd', 'msc', 'url'] }, { name: '*', extensions: ['*'] }] : undefined
          })
          return res.canceled || !res.filePaths[0] ? { ok: false } : { ok: true, value: res.filePaths[0] }
        } finally {
          this.opts.holdOpen(false)
        }
      }
    }
  }

  private async fetchIcon(l: Link): Promise<void> {
    const key = iconKey(l)
    if (this.pending.has(key)) return
    this.pending.add(key)
    try {
      const icon = l.kind === 'web' ? await this.favicon(l.target) : await this.fileIcon(l.target)
      if (icon) {
        this.icons[key] = icon
        await writeJson(this.iconFile, this.icons)
        this.opts.onIcons()
      }
    } catch (err) {
      log.warn(`Icona non disponibile per ${l.title}`, err)
    } finally {
      this.pending.delete(key)
    }
  }

  private async fileIcon(path: string): Promise<string | null> {
    try {
      await stat(path)
    } catch {
      return null
    }
    const img = await app.getFileIcon(path, { size: 'large' })
    return img.isEmpty() ? null : img.toDataURL()
  }

  private async favicon(target: string): Promise<string | null> {
    const url = normalizeUrl(target)
    if (!url) return null
    const ico = new URL('/favicon.ico', url).toString()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FAVICON_TIMEOUT_MS)
    try {
      const res = await net.fetch(ico, { signal: ctrl.signal, credentials: 'omit' } as RequestInit)
      if (!res.ok) return null
      const type = res.headers.get('content-type') ?? 'image/x-icon'
      if (!/^image\//.test(type)) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0 || buf.length > MAX_FAVICON_BYTES) return null
      return `data:${type};base64,${buf.toString('base64')}`
    } finally {
      clearTimeout(timer)
    }
  }
}

function iconKey(l: Pick<Link, 'kind' | 'target'>): string {
  return `${l.kind}:${l.kind === 'web' ? hostOf(l.target) : l.target.toLowerCase()}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function defaultTitle(kind: Link['kind'], target: string): string {
  if (kind === 'web') return hostOf(target).replace(/^www\./, '')
  const name = target.split(/[\\/]/).filter(Boolean).pop() ?? target
  return name.replace(/\.(exe|lnk|url|bat|cmd)$/i, '')
}
