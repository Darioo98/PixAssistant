import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LINK_KINDS, type LinkKind, type LinkView } from '@shared/extras'
import { DeleteButton, RowMenu } from '../RowMenu'
import './extras.css'

function useLinks(): LinkView[] | null {
  const [items, setItems] = useState<LinkView[] | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.dock.links.onChange((l) => alive && setItems(l))
    void window.dock.links.list().then((l) => alive && setItems(l))
    return () => {
      alive = false
      off()
    }
  }, [])
  return items
}

type Editing = { item?: LinkView; kind: LinkKind } | null

export function LinksTab() {
  const { t } = useTranslation()
  const links = useLinks()
  const [editing, setEditing] = useState<Editing>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!links) return null

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const ids = links.map((l) => l.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    void window.dock.links.apply({ op: 'reorder', ids })
    setDragId(null)
  }

  const open = async (l: LinkView) => {
    const r = await window.dock.links.apply({ op: 'open', id: l.id })
    setError(r.ok ? null : t('links.notFound'))
  }

  return (
    <div className="productivity">
      {editing ? (
        <LinkForm editing={editing} onClose={() => setEditing(null)} />
      ) : (
        <div className="toolbar">
          {LINK_KINDS.map((k) => (
            <button key={k} className="btn" onClick={() => setEditing({ kind: k })}>
              + {t(`links.${k}`)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {links.length === 0 ? (
        <p className="empty">{t('links.empty')}</p>
      ) : (
        <>
          <ul className="link-grid">
            {links.map((l) => (
              <li
                key={l.id}
                className={`link-tile ${dragId === l.id ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDragId(l.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drop(l.id)}
              >
                <button className="link-open" title={l.target} onClick={() => void open(l)}>
                  {l.icon ? <img src={l.icon} alt="" /> : <span className="link-letter">{l.title.slice(0, 1).toUpperCase()}</span>}
                  <span className="link-title">{l.title}</span>
                </button>
                <div className="link-menu">
                  <RowMenu label={t('links.more')}>
                    <button onClick={() => setEditing({ item: l, kind: l.kind })}>{t('links.edit')}</button>
                    <DeleteButton onConfirm={() => void window.dock.links.apply({ op: 'remove', id: l.id })} />
                  </RowMenu>
                </div>
              </li>
            ))}
          </ul>
          <p className="hint">{t('links.dragHint')}</p>
        </>
      )}
    </div>
  )
}

function LinkForm({ editing, onClose }: { editing: NonNullable<Editing>; onClose: () => void }) {
  const { t } = useTranslation()
  const { item, kind } = editing
  const [title, setTitle] = useState(item?.title ?? '')
  const [target, setTarget] = useState(item?.target ?? '')
  const [error, setError] = useState<string | null>(null)

  const browse = async () => {
    if (kind === 'web') return
    const r = await window.dock.links.apply({ op: 'pick', kind })
    if (r.ok && r.value) setTarget(r.value)
  }

  return (
    <form
      className="dl-form link-form"
      onSubmit={(e) => {
        e.preventDefault()
        void window.dock.links.apply({ op: 'save', id: item?.id, kind, title: title.trim(), target: target.trim() }).then((r) => {
          if (r.ok) onClose()
          else setError(r.value === 'invalid-url' ? t('links.invalidUrl') : t('vault.errors.generic'))
        })
      }}
    >
      <h2>{t(`links.${kind}`)}</h2>
      <label className="field">
        <span className="label">{kind === 'web' ? t('links.url') : t('links.path')}</span>
        <div className="inline">
          <input className="grow" autoFocus value={target} spellCheck={false} placeholder={kind === 'web' ? 'https://' : ''} onChange={(e) => setTarget(e.target.value)} />
          {kind !== 'web' && (
            <button type="button" className="btn" onClick={() => void browse()}>
              {t('links.browse')}
            </button>
          )}
        </div>
      </label>
      <label className="field">
        <span className="label">{t('links.title')}</span>
        <input value={title} maxLength={100} placeholder={t('links.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          {t('links.cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={!target.trim()}>
          {t('links.save')}
        </button>
      </div>
    </form>
  )
}
