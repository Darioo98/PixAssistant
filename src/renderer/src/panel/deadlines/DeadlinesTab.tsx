import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ISODate } from '@shared/dates'
import { compareByUrgency, deadlineStatus, type DeadlineItem } from '@shared/deadlines'
import { useDeadlines, useToday } from '../../hooks'
import { CalendarView } from './CalendarView'
import { DeadlineForm } from './DeadlineForm'
import { DeadlineRow } from './DeadlineRow'
import './deadlines.css'

type View = 'list' | 'calendar'
type Filter = 'active' | 'overdue' | 'done' | 'all'
const FILTERS: Filter[] = ['active', 'overdue', 'done', 'all']
const VIEW_KEY = 'pix.deadlines.view'

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'
  } catch {
    return 'list'
  }
}

export function DeadlinesTab({ defaultLead }: { defaultLead: number }) {
  const { t } = useTranslation()
  const items = useDeadlines()
  const today = useToday()
  const [view, setViewState] = useState<View>(loadView)
  const [filter, setFilter] = useState<Filter>('active')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<{ item?: DeadlineItem; date: ISODate } | null>(null)

  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // preferenza non essenziale
    }
  }

  const categories = useMemo(
    () => [...new Set((items ?? []).map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items]
  )

  const visible = useMemo(() => {
    if (!items) return []
    return items
      .filter((i) => {
        const s = deadlineStatus(i, today, defaultLead)
        if (filter === 'active' && s === 'done') return false
        if (filter === 'overdue' && s !== 'overdue') return false
        if (filter === 'done' && s !== 'done') return false
        return !category || i.category === category
      })
      .sort(compareByUrgency(today, defaultLead))
  }, [items, filter, category, today, defaultLead])

  if (!items) return null

  if (editing) {
    return (
      <DeadlineForm
        key={editing.item?.id ?? 'new'}
        item={editing.item}
        date={editing.date}
        defaultLead={defaultLead}
        categories={categories}
        onClose={() => setEditing(null)}
      />
    )
  }

  const edit = (item: DeadlineItem) => setEditing({ item, date: item.date })

  return (
    <div className="deadlines">
      <div className="toolbar">
        <div className="segmented" role="tablist">
          {(['list', 'calendar'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {t(`deadlines.views.${v}`)}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setEditing({ date: today })}>
          + {t('deadlines.new')}
        </button>
      </div>

      {view === 'calendar' ? (
        <CalendarView
          items={items}
          today={today}
          defaultLead={defaultLead}
          onEdit={edit}
          onAdd={(date) => setEditing({ date })}
        />
      ) : (
        <>
          <div className="filters">
            {FILTERS.map((f) => (
              <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
                {t(`deadlines.filters.${f}`)}
              </button>
            ))}
            {categories.length > 0 && (
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('deadlines.form.category')}>
                <option value="">{t('deadlines.allCategories')}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>
          {visible.length === 0 ? (
            <p className="empty">{items.length === 0 ? t('deadlines.empty') : t('deadlines.emptyFilter')}</p>
          ) : (
            <ul className="dl-list">
              {visible.map((item) => (
                <DeadlineRow key={item.id} item={item} today={today} defaultLead={defaultLead} onEdit={edit} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
