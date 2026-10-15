import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClipEntry, ClipState } from '@shared/extras'
import { DeleteButton, RowMenu } from '../RowMenu'
import './extras.css'
import { Glyph } from '../Glyph'

function useClipboardState(): ClipState | null {
  const [state, setState] = useState<ClipState | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.pix.clipboard.onChange((s) => alive && setState(s))
    void window.pix.clipboard.state().then((s) => alive && s && setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

export function ClipboardTab() {
  const { t } = useTranslation()
  const state = useClipboardState()
  const [query, setQuery] = useState('')

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = state?.entries ?? []
    const filtered = q ? list.filter((e) => e.kind === 'text' && e.text?.toLowerCase().includes(q)) : list
    // Le fissate in alto, poi le più recenti.
    return [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  }, [state, query])

  if (!state) return null
  if (!state.available) return <p className="empty">{t('clipboard.unavailable')}</p>

  return (
    <div className="productivity">
      <div className="toolbar">
        <input className="search" type="search" value={query} placeholder={t('clipboard.search')} aria-label={t('clipboard.search')} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn" onClick={() => void window.pix.clipboard.apply({ op: 'pause', paused: !state.paused })}>
          {state.paused ? t('clipboard.resume') : t('clipboard.pause')}
        </button>
      </div>
      {state.paused && <p className="warning">{t('clipboard.paused')}</p>}
      {entries.length === 0 ? (
        <p className="empty">{state.entries.length === 0 ? t('clipboard.empty') : t('clipboard.noResults')}</p>
      ) : (
        <ul className="clip-list">
          {entries.map((e) => (
            <ClipRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
      <div className="form-actions">
        <span className="hint">{t('clipboard.privacy')}</span>
        <span className="spacer" />
        {state.entries.some((e) => !e.pinned) && (
          <DeleteButton className="btn subtle" onConfirm={() => void window.pix.clipboard.apply({ op: 'clear' })} />
        )}
      </div>
    </div>
  )
}

function ClipRow({ entry }: { entry: ClipEntry }) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(entry.at)
  return (
    <li className={`clip-row ${entry.pinned ? 'pinned' : ''}`}>
      <button
        className="clip-main"
        title={t('clipboard.copied')}
        onClick={() =>
          void window.pix.clipboard.apply({ op: 'copy', id: entry.id }).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }
      >
        {entry.kind === 'image' ? (
          <span className="clip-image">
            {entry.thumb && <img src={entry.thumb} alt="" />}
            <span>{t('clipboard.image', { w: entry.width, h: entry.height })}</span>
          </span>
        ) : (
          <span className="clip-text">{entry.text}</span>
        )}
        <span className="dl-meta">
          {copied ? t('clipboard.copied') : time}
          {entry.source && ` · ${t('clipboard.from', { app: entry.source.replace(/\.exe$/i, '') })}`}
          {entry.pinned && <> · <Glyph name="pinned" size={12} /></>}
        </span>
      </button>
      <RowMenu label={t('clipboard.more')}>
        <button onClick={() => void window.pix.clipboard.apply({ op: 'pin', id: entry.id, pinned: !entry.pinned })}>
          {entry.pinned ? t('clipboard.unpin') : t('clipboard.pin')}
        </button>
        <DeleteButton onConfirm={() => void window.pix.clipboard.apply({ op: 'remove', id: entry.id })} />
      </RowMenu>
    </li>
  )
}
