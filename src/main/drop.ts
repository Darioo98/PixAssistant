import { shell } from 'electron'
import { stat } from 'node:fs/promises'
import type { TFunction } from 'i18next'
import type { LinksService } from './links'
import type { NotesService } from './productivity'
import type { BubbleRequest } from './mascot'
import { isAbsoluteWinPath, normalizeUrl, type DropPayload, type LinkKind } from '@shared/extras'
import { log } from './log'

export interface DropDeps {
  links: LinksService
  notes: NotesService
  t: () => TFunction
  bubble: (req: BubbleRequest) => void
  happy: () => void
  openPanel: (tab: 'links' | 'notes') => void
}

const nameOf = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/**
 * Pix "inghiotte" ciò che gli lasci cadere sopra, tutto in locale:
 * file e cartelle diventano link rapidi, un indirizzo web un link, il testo una nota.
 * Nulla viene aperto o inviato altrove senza un tuo clic.
 */
export async function handleDrop(payload: DropPayload, deps: DropDeps): Promise<boolean> {
  const t = deps.t()
  const category = t('drop.category')
  const existing = deps.links.store.list()
  const known = (target: string) => existing.some((l) => l.target.toLowerCase() === target.toLowerCase())

  // ---- File e cartelle ----
  const saved: Array<{ kind: LinkKind; target: string }> = []
  let already = 0
  for (const path of payload.paths) {
    if (!isAbsoluteWinPath(path)) continue
    let kind: LinkKind
    try {
      kind = (await stat(path)).isDirectory() ? 'folder' : 'app'
    } catch {
      continue
    }
    if (known(path)) {
      already++
      continue
    }
    const r = await deps.links.apply({ op: 'save', kind, title: '', target: path })
    if (r.ok) saved.push({ kind, target: path })
  }
  if (saved.length || already) {
    deps.happy()
    const first = saved[0]
    const text =
      saved.length === 0
        ? t('drop.already')
        : saved.length === 1
          ? t(first!.kind === 'folder' ? 'drop.savedFolder' : 'drop.savedFile', { name: nameOf(first!.target) })
          : t('drop.savedMany', { count: saved.length })
    const actions = [{ id: 'links', label: t('drop.openLinks'), primary: saved.length !== 1 }]
    if (saved.length === 1) actions.unshift({ id: 'show', label: t('drop.showInFolder'), primary: false }, { id: 'open', label: t('drop.open'), primary: true })
    deps.bubble({
      category,
      text,
      alert: false,
      actions,
      onOutcome: (o) => {
        if (o.kind !== 'action') return
        if (o.actionId === 'links') deps.openPanel('links')
        else if (o.actionId === 'show' && first) shell.showItemInFolder(first.target)
        else if (o.actionId === 'open' && first) void shell.openPath(first.target).then((err) => err && log.warn(`Apertura non riuscita: ${err}`))
      }
    })
    return true
  }

  // ---- Testo: un indirizzo web diventa un link, il resto una nota ----
  const text = payload.text.trim()
  if (!text) return false
  const url = !/\s/.test(text) ? normalizeUrl(text) : null
  if (url) {
    if (!known(url)) await deps.links.apply({ op: 'save', kind: 'web', title: '', target: url })
    deps.happy()
    deps.bubble({
      category,
      text: known(url) ? t('drop.already') : t('drop.savedUrl', { name: new URL(url).host.replace(/^www\./, '') }),
      alert: false,
      actions: [
        { id: 'links', label: t('drop.openLinks') },
        { id: 'open', label: t('drop.open'), primary: true }
      ],
      onOutcome: (o) => {
        if (o.kind !== 'action') return
        if (o.actionId === 'links') deps.openPanel('links')
        else void shell.openExternal(url)
      }
    })
    return true
  }
  deps.notes.apply({ op: 'save', note: { title: '', body: text.slice(0, 200_000), pinned: false } })
  deps.happy()
  deps.bubble({
    category,
    text: t('drop.savedNote'),
    alert: false,
    actions: [{ id: 'notes', label: t('drop.openNotes'), primary: true }],
    onOutcome: (o) => o.kind === 'action' && deps.openPanel('notes')
  })
  return true
}
