import { useTranslation } from 'react-i18next'
import { addDays, diffDays, type ISODate } from '@shared/dates'
import { deadlineStatus, isRecurring, type DeadlineItem } from '@shared/deadlines'
import { dueLabel, formatDate, repeatLabel } from '../../format'
import { DeleteButton, RowMenu } from '../RowMenu'

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
  const apply = window.pix.deadlines.apply

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
        <RowMenu label={t('deadlines.actions.more')}>
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
