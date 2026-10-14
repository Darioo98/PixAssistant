import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isValidISODate, parseISODate, type ISODate } from '@shared/dates'
import { RECURRENCE_UNITS, isRecurring, type DeadlineItem, type RecurrenceUnit } from '@shared/deadlines'
import { formatDate, formatTimestamp } from '../../format'
import { DeleteButton } from './DeadlineRow'

interface Props {
  item?: DeadlineItem
  date: ISODate
  defaultLead: number
  categories: string[]
  onClose: () => void
}

/** Crea o modifica una scadenza. */
export function DeadlineForm({ item, date, defaultLead, categories, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const [title, setTitle] = useState(item?.title ?? '')
  const [day, setDay] = useState(item?.date ?? date)
  const [unit, setUnit] = useState<RecurrenceUnit>(item?.recurrence.unit ?? 'none')
  const [every, setEvery] = useState(item?.recurrence.every ?? 1)
  const [customLead, setCustomLead] = useState(item?.leadDays != null)
  const [lead, setLead] = useState(item?.leadDays ?? defaultLead)
  const [category, setCategory] = useState(item?.category ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [saving, setSaving] = useState(false)

  const valid = title.trim().length > 0 && isValidISODate(day) && every >= 1 && lead >= 0
  const showMonthEnd = (unit === 'month' || unit === 'year') && isValidISODate(day) && parseISODate(day).d > 28

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    const ok = await window.dock.deadlines.apply({
      op: 'save',
      input: {
        id: item?.id,
        title: title.trim(),
        date: day,
        recurrence: { unit, every: unit === 'none' ? 1 : every },
        leadDays: customLead ? lead : null,
        category: category.trim(),
        notes
      }
    })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <form
      className="dl-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h2>{item ? t('deadlines.form.editTitle') : t('deadlines.new')}</h2>

      <label className="field">
        <span className="label">{t('deadlines.form.title')}</span>
        <input
          autoFocus
          value={title}
          maxLength={200}
          placeholder={t('deadlines.form.titlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="label">{t('deadlines.form.date')}</span>
        <input type="date" value={day} required onChange={(e) => setDay(e.target.value)} />
      </label>

      <div className="field">
        <span className="label">{t('deadlines.form.recurrence')}</span>
        <div className="inline">
          {unit !== 'none' && (
            <>
              <span>{t('deadlines.form.every')}</span>
              <input
                type="number"
                className="num"
                min={1}
                max={999}
                value={every}
                onChange={(e) => setEvery(Math.max(1, Math.min(999, Math.round(Number(e.target.value)) || 1)))}
              />
            </>
          )}
          <select value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)}>
            {RECURRENCE_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`deadlines.form.units.${u}`)}
              </option>
            ))}
          </select>
        </div>
        {showMonthEnd && <span className="hint">{t('deadlines.form.monthEndHint')}</span>}
      </div>

      <div className="field">
        <span className="label">{t('deadlines.form.lead')}</span>
        <div className="inline">
          <select value={customLead ? 'custom' : 'default'} onChange={(e) => setCustomLead(e.target.value === 'custom')}>
            <option value="default">{t('deadlines.form.leadDefault', { count: defaultLead })}</option>
            <option value="custom">{t('deadlines.form.leadCustom')}</option>
          </select>
          {customLead && (
            <>
              <input
                type="number"
                className="num"
                min={0}
                max={365}
                value={lead}
                onChange={(e) => setLead(Math.max(0, Math.min(365, Math.round(Number(e.target.value)) || 0)))}
              />
              <span>{t('deadlines.form.leadDays')}</span>
            </>
          )}
        </div>
      </div>

      <label className="field">
        <span className="label">{t('deadlines.form.category')}</span>
        <input
          value={category}
          maxLength={60}
          list="dl-categories"
          placeholder={t('deadlines.form.categoryPlaceholder')}
          onChange={(e) => setCategory(e.target.value)}
        />
        <datalist id="dl-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="label">{t('deadlines.form.notes')}</span>
        <textarea rows={3} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {item && isRecurring(item) && item.history.length > 0 && (
        <div className="field">
          <span className="label">{t('deadlines.form.history')}</span>
          <ul className="dl-history">
            {item.history.slice(0, 10).map((h) => (
              <li key={`${h.date}-${h.doneAt}`}>
                {formatDate(h.date, i18n.language)} — {t('deadlines.due.done', { date: formatTimestamp(h.doneAt, i18n.language) })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-actions">
        {item && (
          <DeleteButton
            className="btn danger-text"
            onConfirm={() => {
              void window.dock.deadlines.apply({ op: 'remove', id: item.id })
              onClose()
            }}
          />
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          {t('deadlines.form.cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={!valid || saving}>
          {t('deadlines.form.save')}
        </button>
      </div>
    </form>
  )
}
