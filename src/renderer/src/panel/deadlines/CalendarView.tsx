import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, diffDays, formatISODate, parseISODate, weekday, type ISODate } from '@shared/dates'
import { deadlineStatus, isRecurring, occurrencesBetween, type DeadlineItem, type DeadlineStatus } from '@shared/deadlines'
import { firstDayOfWeek, formatDate } from '../../format'
import { DeadlineRow } from './DeadlineRow'
import { Glyph } from '../Glyph'

type Mark = { item: DeadlineItem; kind: 'due' | 'future' | 'done'; status: DeadlineStatus }

const RANK: Record<string, number> = { overdue: 0, today: 1, soon: 2, week: 3, later: 4, future: 5, done: 6 }

interface Props {
  items: DeadlineItem[]
  today: ISODate
  defaultLead: number
  onEdit: (item: DeadlineItem) => void
  onAdd: (date: ISODate) => void
}

/** Calendario mensile: giorni colorati per urgenza, ripetizioni future e occorrenze fatte. */
export function CalendarView({ items, today, defaultLead, onEdit, onAdd }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [month, setMonth] = useState(() => {
    const { y, m } = parseISODate(today)
    return { y, m }
  })
  const [selected, setSelected] = useState<ISODate>(today)

  const first = formatISODate(month.y, month.m, 1)
  const weekStart = firstDayOfWeek(lang) % 7 // 0 = domenica
  const gridStart = addDays(first, -((weekday(first) - weekStart + 7) % 7))
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const gridEnd = days[41]!

  const marks = useMemo(() => {
    const map = new Map<ISODate, Mark[]>()
    const add = (date: ISODate, mark: Mark) => map.set(date, [...(map.get(date) ?? []), mark])
    for (const item of items) {
      const status = deadlineStatus(item, today, defaultLead)
      if (status === 'done') {
        if (diffDays(gridStart, item.date) >= 0 && diffDays(item.date, gridEnd) >= 0) add(item.date, { item, kind: 'done', status })
        continue
      }
      occurrencesBetween(item, gridStart, gridEnd).forEach((date) =>
        add(date, { item, kind: date === item.date ? 'due' : 'future', status })
      )
      if (isRecurring(item)) {
        for (const h of item.history) {
          if (diffDays(gridStart, h.date) >= 0 && diffDays(h.date, gridEnd) >= 0) add(h.date, { item, kind: 'done', status: 'done' })
        }
      }
    }
    return map
  }, [items, today, defaultLead, gridStart, gridEnd])

  const cellClass = (list: Mark[] | undefined) => {
    if (!list?.length) return ''
    const best = list
      .map((m) => (m.kind === 'due' ? m.status : m.kind))
      .sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9))[0]
    return `has st-${best}`
  }

  const shift = (n: number) => {
    const total = month.y * 12 + month.m - 1 + n
    setMonth({ y: Math.floor(total / 12), m: (total % 12) + 1 })
  }

  const weekdays = days.slice(0, 7).map((d) => formatDate(d, lang, { weekday: 'narrow' }))
  const selectedMarks = marks.get(selected) ?? []

  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="icon-btn" aria-label={t('deadlines.calendar.prev')} onClick={() => shift(-1)}>
          <Glyph name="chevronLeft" size={12} />
        </button>
        <span className="cal-title">{formatDate(first, lang, { month: 'long', year: 'numeric' })}</span>
        <button className="icon-btn" aria-label={t('deadlines.calendar.next')} onClick={() => shift(1)}>
          <Glyph name="chevronRight" size={12} />
        </button>
        <button
          className="btn subtle"
          onClick={() => {
            const { y, m } = parseISODate(today)
            setMonth({ y, m })
            setSelected(today)
          }}
        >
          {t('deadlines.calendar.today')}
        </button>
      </div>

      <div className="cal-grid" role="grid">
        {weekdays.map((w, i) => (
          <span key={i} className="cal-wd">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const { m, d: dayNum } = parseISODate(d)
          const list = marks.get(d)
          return (
            <button
              key={d}
              role="gridcell"
              className={[
                'cal-day',
                m !== month.m ? 'other' : '',
                d === today ? 'today' : '',
                d === selected ? 'selected' : '',
                cellClass(list)
              ].join(' ')}
              aria-label={`${formatDate(d, lang, { dateStyle: 'full' })}${list?.length ? ` (${list.length})` : ''}`}
              onClick={() => setSelected(d)}
              onDoubleClick={() => onAdd(d)}
            >
              <span>{dayNum}</span>
              {list && list.length > 0 && <i className="cal-count">{list.length > 1 ? list.length : ''}</i>}
            </button>
          )
        })}
      </div>

      <div className="cal-day-detail">
        <div className="cal-day-head">
          <strong>{formatDate(selected, lang, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
          <button className="btn subtle" onClick={() => onAdd(selected)}>
            + {t('deadlines.calendar.add')}
          </button>
        </div>
        {selectedMarks.length === 0 ? (
          <p className="hint">{t('deadlines.calendar.noneOnDay')}</p>
        ) : (
          <ul className="dl-list">
            {selectedMarks.map((mk) =>
              mk.kind === 'due' ? (
                <DeadlineRow key={mk.item.id} item={mk.item} today={today} defaultLead={defaultLead} onEdit={onEdit} />
              ) : (
                <li key={`${mk.item.id}-${mk.kind}`} className={`dl-row ghost st-${mk.kind}`}>
                  <span className="dl-dot" aria-hidden="true" />
                  <button className="dl-main" onClick={() => onEdit(mk.item)}>
                    <span className="dl-title">{mk.item.title}</span>
                    <span className="dl-meta">
                      {mk.kind === 'done' ? t('deadlines.filters.done') : t('deadlines.form.recurrence')}
                    </span>
                  </button>
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
