import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, diffDays, type ISODate } from '@shared/dates'
import { deadlineStatus, isRecurring, type DeadlineItem } from '@shared/deadlines'
import { dueLabel, formatDate, repeatLabel } from '../../format'

interface Props {
  item: DeadlineItem
  today: ISODate
  defaultLead: number
  onEdit: (item: DeadlineItem) => void
  compact?: boolean
}

const SNOOZE = [
  ['d1', 1],
  ['d3', 3],
  ['w1', 7]
] as const

/** Riga di una scadenza: stato colorato, data, ripetizione e azioni rapide. */
export function DeadlineRow({ item, today, defaultLead, onEdit, compact = false }: Props) {
  const { t, i18n } = useTranslation()
  const status = deadlineStatus(item, today, defaultLead)
  const repeat = repeatLabel(item, t)
  const snoozed = item.snoozedUntil && diffDays(today, item.snoozedUntil) > 0 ? item.snoozedUntil : null
  const canReopen = status === 'done' || (isRecurring(item) && item.history.length > 0)
  const apply = window.dock.deadlines.apply

  const meta = [
    dueLabel(item, status, today, t, i18n.language),
    status !== 'done' ? formatDate(item.date, i18n.language) : null,
    repeat,
    !compact && item.category ? item.category : null
  ].filter(Boolean)

  return (
    <li className={`dl-row st-${status}`}>
      <span className="dl-dot" aria-hidden="true" />
      <button className="dl-main" onClick={() => onEdit(item)}>
        <span className="dl-title">{item.title}</span>
        <span className="dl-meta">{meta.join(' · ')}</span>
        {snoozed && <span className="dl-meta">{t('deadlines.snoozedUntil', { date: formatDate(snoozed, i18n.language) })}</span>}
      </button>
      {status === 'done' ? (
        <button className="pill small" onClick={() => void apply({ op: 'reopen', id: item.id })}>
          {t('deadlines.actions.reopen')}
        </button>
      ) : (
        <button className="pill small primary" onClick={() => void apply({ op: 'done', id: item.id })}>
          {t('deadlines.actions.done')}
        </button>
      )}
      {!compact && (
        <RowMenu>
          {status !== 'done' &&
            SNOOZE.map(([key, days]) => (
              <button key={key} onClick={() => void apply({ op: 'snooze', id: item.id, until: addDays(today, days) })}>
                {t('deadlines.actions.snooze')}: {t(`deadlines.snoozeOptions.${key}`)}
              </button>
            ))}
          <button onClick={() => onEdit(item)}>{t('deadlines.actions.edit')}</button>
          {canReopen && status !== 'done' && (
            <button onClick={() => void apply({ op: 'reopen', id: item.id })}>{t('deadlines.actions.reopen')}</button>
          )}
          <DeleteButton onConfirm={() => void apply({ op: 'remove', id: item.id })} />
        </RowMenu>
      )}
    </li>
  )
}

/** Menu "…" con le azioni secondarie. */
function RowMenu({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="row-menu" ref={ref}>
      <button className="icon-btn" aria-label={t('deadlines.actions.more')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <circle cx="5" cy="10" r="1.5" fill="currentColor" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
          <circle cx="15" cy="10" r="1.5" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="menu" role="menu" onClick={(e) => (e.target as HTMLElement).dataset.keep === undefined && setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}

/** Eliminazione in due passi: niente si perde con un clic sbagliato. */
export function DeleteButton({ onConfirm, className = 'danger' }: { onConfirm: () => void; className?: string }) {
  const { t } = useTranslation()
  const [armed, setArmed] = useState(false)
  return armed ? (
    <button className={className} onClick={onConfirm}>
      {t('deadlines.form.confirmDelete')}
    </button>
  ) : (
    <button className={className} data-keep onClick={() => setArmed(true)}>
      {t('deadlines.actions.delete')}
    </button>
  )
}
