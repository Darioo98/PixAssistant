import { shell } from 'electron'
import { stat } from 'node:fs/promises'
import type { TFunction } from 'i18next'
import type { LinksService } from './links'
import type { NotesService } from './productivity'
import type { BubbleRequest } from './mascot'
import { readAttachment, readableKind, type Attachment } from './attachments'
import { isAbsoluteWinPath, normalizeUrl, type DropPayload, type LinkKind } from '@shared/extras'
import { log } from './log'

export interface DropDeps {
  links: LinksService
  notes: NotesService
  t: () => TFunction
  /** Mostra un fumetto; restituisce il suo id (null se i fumetti sono silenziati). */
  bubble: (req: BubbleRequest) => string | null | void
  /** Chiude un fumetto ancora aperto o in coda. */
  dismiss: (id: string) => void
  happy: () => void
  openPanel: (tab: 'links' | 'notes') => void
  /** Apre una nuova chat sui documenti e la mostra. */
  analyze: (files: Attachment[], prompt: string, title: string) => Promise<boolean>
}

/** Quanto resta aperta la domanda "cosa ne faccio?". */
const CHOICE_TIMEOUT_MS = 45_000
/** Quanti documenti al massimo in una stessa analisi. */
const MAX_ANALYZE = 5

const nameOf = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Domanda "cosa ne faccio?" ancora aperta: un nuovo boccone la sostituisce. */
let openQuestion: string | null = null

function ask(deps: DropDeps, req: BubbleRequest): void {
  if (openQuestion) deps.dismiss(openQuestion)
  const id = deps.bubble({
    ...req,
    onOutcome: (o) => {
      if (openQuestion === id) openQuestion = null
      req.onOutcome?.(o)
    }
  })
  openQuestion = typeof id === 'string' ? id : null
}

interface Item {
  path: string
  kind: LinkKind
  /** La chat lo sa leggere (PDF, immagine, Word, testo). */
  readable: boolean
}

/**
 * Pix "inghiotte" ciò che gli lasci cadere sopra e ti chiede cosa farne:
 * salvarlo (file e cartelle nei Link, il testo in una nota) oppure farlo
 * analizzare alla chat. Nulla viene salvato, aperto o inviato senza la tua scelta;
 * il contenuto va a Claude solo se scegli "Analizza".
 */
export async function handleDrop(payload: DropPayload, deps: DropDeps): Promise<boolean> {
  const t = deps.t()
  const category = t('drop.category')

  const items: Item[] = []
  for (const path of payload.paths) {
    if (!isAbsoluteWinPath(path)) continue
    try {
      const folder = (await stat(path)).isDirectory()
      items.push({ path, kind: folder ? 'folder' : 'app', readable: !folder && readableKind(path) !== null })
    } catch {
      // file sparito nel frattempo
    }
  }

  if (items.length) {
    deps.happy()
    const readable = items.filter((i) => i.readable).slice(0, MAX_ANALYZE)
    const single = items.length === 1 ? items[0]! : null
    const what = single ? t(single.kind === 'folder' ? 'drop.gotFolder' : 'drop.gotFile', { name: nameOf(single.path) }) : t('drop.gotMany', { count: items.length })
    const hint = readable.length ? t('drop.privacy') : single && single.kind !== 'folder' ? t('drop.cantRead') : ''
    ask(deps, {
      category,
      text: [what, hint].filter(Boolean).join('\n'),
      alert: false,
      timeoutMs: CHOICE_TIMEOUT_MS,
      actions: [
        { id: 'save', label: t('drop.saveLinks'), primary: readable.length === 0 },
        ...(readable.length ? [{ id: 'analyze', label: t('drop.analyze'), primary: true }] : [])
      ],
      onOutcome: (o) => {
        if (o.kind !== 'action') return
        if (o.actionId === 'save') void saveLinks(items, deps)
        if (o.actionId === 'analyze') void analyzeFiles(readable, deps)
      }
    })
    return true
  }

  // ---- Testo: un indirizzo web diventa un link, il resto una nota o un'analisi ----
  const text = payload.text.trim()
  if (!text) return false
  const url = !/\s/.test(text) ? normalizeUrl(text) : null
  deps.happy()
  if (url) {
    ask(deps, {
      category,
      text: t('drop.gotUrl', { name: new URL(url).host.replace(/^www\./, '') }),
      alert: false,
      timeoutMs: CHOICE_TIMEOUT_MS,
      actions: [
        { id: 'open', label: t('drop.open') },
        { id: 'save', label: t('drop.saveLinks'), primary: true }
      ],
      onOutcome: (o) => {
        if (o.kind !== 'action') return
        if (o.actionId === 'open') void shell.openExternal(url)
        else void saveUrl(url, deps)
      }
    })
    return true
  }
  ask(deps, {
    category,
    text: `${t('drop.gotText')}\n${t('drop.privacy')}`,
    alert: false,
    timeoutMs: CHOICE_TIMEOUT_MS,
    actions: [
      { id: 'note', label: t('drop.saveNote') },
      { id: 'analyze', label: t('drop.analyze'), primary: true }
    ],
    onOutcome: (o) => {
      if (o.kind !== 'action') return
      if (o.actionId === 'note') {
        deps.notes.apply({ op: 'save', note: { title: '', body: text.slice(0, 200_000), pinned: false } })
        deps.bubble({ category, text: t('drop.savedNote'), alert: false, actions: [{ id: 'notes', label: t('drop.openNotes'), primary: true }], onOutcome: (r) => r.kind === 'action' && deps.openPanel('notes') })
      } else {
        void deps.analyze([{ name: t('drop.textName'), kind: 'text', text: text.slice(0, 400_000) }], t('drop.analyzeText'), `📎 ${t('drop.textName')}`)
      }
    }
  })
  return true
}

async function saveLinks(items: Item[], deps: DropDeps): Promise<void> {
  const t = deps.t()
  const existing = deps.links.store.list()
  let saved = 0
  for (const i of items) {
    if (existing.some((l) => l.target.toLowerCase() === i.path.toLowerCase())) continue
    if ((await deps.links.apply({ op: 'save', kind: i.kind, title: '', target: i.path })).ok) saved++
  }
  const single = items.length === 1 ? items[0]! : null
  const text = saved === 0 ? t('drop.already') : single ? t('drop.savedOne', { name: nameOf(single.path) }) : t('drop.savedMany', { count: saved })
  deps.bubble({
    category: t('drop.category'),
    text,
    alert: false,
    actions: [
      ...(single ? [{ id: 'show', label: t('drop.showInFolder') }] : []),
      { id: 'links', label: t('drop.openLinks'), primary: true }
    ],
    onOutcome: (o) => {
      if (o.kind !== 'action') return
      if (o.actionId === 'show' && single) shell.showItemInFolder(single.path)
      else deps.openPanel('links')
    }
  })
}

async function saveUrl(url: string, deps: DropDeps): Promise<void> {
  const t = deps.t()
  const known = deps.links.store.list().some((l) => l.target.toLowerCase() === url.toLowerCase())
  if (!known) await deps.links.apply({ op: 'save', kind: 'web', title: '', target: url })
  deps.bubble({
    category: t('drop.category'),
    text: known ? t('drop.already') : t('drop.savedOne', { name: new URL(url).host.replace(/^www\./, '') }),
    alert: false,
    actions: [{ id: 'links', label: t('drop.openLinks'), primary: true }],
    onOutcome: (o) => o.kind === 'action' && deps.openPanel('links')
  })
}

async function analyzeFiles(items: Item[], deps: DropDeps): Promise<void> {
  const t = deps.t()
  const files: Attachment[] = []
  const problems: string[] = []
  for (const i of items) {
    const r = await readAttachment(i.path)
    if ('error' in r) problems.push(t(`drop.readError.${r.error}`, { name: nameOf(i.path) }))
    else files.push(r)
  }
  if (problems.length) log.warn(`Allegati non letti: ${problems.length}`)
  if (!files.length) {
    deps.bubble({ category: t('drop.category'), text: problems.join('\n') || t('drop.cantRead'), alert: true })
    return
  }
  const prompt = files.length === 1 ? t(files[0]!.kind === 'image' ? 'drop.analyzeImage' : 'drop.analyzeDoc') : t('drop.analyzeMany')
  const title = `📎 ${files.map((f) => f.name).join(', ')}`.slice(0, 120)
  await deps.analyze(files, prompt, title)
  if (problems.length) deps.bubble({ category: t('drop.category'), text: problems.join('\n'), alert: false })
}
