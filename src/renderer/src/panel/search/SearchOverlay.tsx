import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { noteTitle, parseLocal } from '@shared/productivity'
import { groupPath } from '@shared/vault'
import { search, type SearchDoc, type SearchGroup, type SearchHit } from '@shared/search'
import { formatDate } from '../../format'
import { requestFocus } from '../focus'
import './search.css'
import { Glyph, type GlyphName } from '../Glyph'

const ICONS: Record<SearchGroup, GlyphName> = {
  notes: 'note',
  todos: 'todo',
  reminders: 'reminder',
  deadlines: 'calendar',
  links: 'link',
  clipboard: 'clipboard',
  vault: 'key'
}

/** Carica tutto ciò in cui si può cercare (le password non arrivano mai al renderer). */
async function loadDocs(lang: string, t: (k: string) => string): Promise<SearchDoc[]> {
  const [notes, todos, reminders, deadlines, links, clip, vault] = await Promise.all([
    window.pix.data.list('notes'),
    window.pix.data.list('todos'),
    window.pix.data.list('reminders'),
    window.pix.deadlines.list(),
    window.pix.links.list(),
    window.pix.clipboard.state(),
    window.pix.vault.list()
  ])
  const time = (at: string) => parseLocal(at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })
  return [
    ...notes.map((n) => ({ group: 'notes' as const, id: n.id, title: noteTitle(n, t('notes.untitled')), body: n.body })),
    ...todos.map((x) => ({ group: 'todos' as const, id: x.id, title: x.text, detail: x.done ? t('search.done') : x.due ? formatDate(x.due, lang) : undefined })),
    ...reminders.filter((r) => !r.done).map((r) => ({ group: 'reminders' as const, id: r.id, title: r.text, detail: time(r.at) })),
    ...deadlines.map((d) => ({ group: 'deadlines' as const, id: d.id, title: d.title, body: `${d.category}\n${d.notes}`, detail: formatDate(d.date, lang) })),
    ...links.map((l) => ({ group: 'links' as const, id: l.id, title: l.title, body: l.target, detail: l.target })),
    ...clip.entries.filter((c) => c.kind === 'text' && c.text).map((c) => ({ group: 'clipboard' as const, id: c.id, title: c.text!.split(/\r?\n/)[0]!.slice(0, 120), body: c.text })),
    ...vault.entries.map((e) => ({ group: 'vault' as const, id: e.id, title: e.name, detail: groupPath(e.groupId, vault.groups).join(' › ') || undefined }))
  ]
}

export function SearchOverlay({ initial, onClose }: { initial: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState(initial)
  const [docs, setDocs] = useState<SearchDoc[] | null>(null)
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void loadDocs(i18n.language, t).then((d) => alive && setDocs(d))
    inputRef.current?.focus()
    return () => {
      alive = false
    }
  }, [])

  const hits = useMemo(() => (docs ? search(docs, query) : []), [docs, query])
  useEffect(() => setActive(0), [query])

  const open = async (h: SearchHit) => {
    switch (h.group) {
      case 'notes':
        requestFocus({ tab: 'notes', noteId: h.id })
        break
      case 'todos':
        requestFocus({ tab: 'notes', segment: 'todos' })
        break
      case 'reminders':
        requestFocus({ tab: 'timers' })
        break
      case 'deadlines':
        requestFocus({ tab: 'deadlines' })
        break
      case 'vault':
        requestFocus({ tab: 'vault', query: h.title })
        break
      case 'links':
        await window.pix.links.apply({ op: 'open', id: h.id })
        break
      case 'clipboard':
        await window.pix.clipboard.apply({ op: 'copy', id: h.id })
        setCopied(h.id)
        window.setTimeout(onClose, 700)
        return
    }
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(hits.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault()
      void open(hits[active]!)
    }
  }

  let lastGroup: SearchGroup | null = null
  return (
    <div className="search-overlay" role="dialog" aria-label={t('search.title')} onKeyDown={onKeyDown}>
      <div className="search-box">
        <Glyph name="search" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={t('search.placeholder')}
          aria-label={t('search.title')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn subtle" onClick={onClose}>
          {t('search.close')}
        </button>
      </div>
      <div className="search-results" role="listbox">
        {!query.trim() && <p className="hint">{t('search.hint')}</p>}
        {query.trim() && docs && hits.length === 0 && <p className="hint">{t('search.none')}</p>}
        {hits.map((h, i) => {
          const header = h.group !== lastGroup
          lastGroup = h.group
          return (
            <div key={`${h.group}:${h.id}`}>
              {header && <div className="search-group">{t(`search.groups.${h.group}`)}</div>}
              <button
                role="option"
                aria-selected={i === active}
                className={`search-hit ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => void open(h)}
              >
                <Glyph name={ICONS[h.group]} className="search-icon" />
                <span className="search-text">
                  <span className="search-title">{h.title}</span>
                  {(h.snippet || h.detail) && <span className="search-detail">{h.snippet ?? h.detail}</span>}
                </span>
                {copied === h.id && <span className="search-badge">{t('search.copied')}</span>}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
