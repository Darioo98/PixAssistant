import type { TFunction } from 'i18next'
import { dayNumber, diffDays, type ISODate } from '@shared/dates'
import { isRecurring, type Deadline, type DeadlineStatus } from '@shared/deadlines'

const DAY_MS = 86_400_000

/** Data di calendario nel formato locale (es. "31 gen 2027"). */
export function formatDate(iso: ISODate, lang: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  return new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' }).format(new Date(dayNumber(iso) * DAY_MS))
}

export function formatTimestamp(ms: number, lang: string) {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(ms)
}

/** "Scade tra 3 giorni", "Scaduta ieri", "Fatta il …". */
export function dueLabel(d: Deadline, status: DeadlineStatus, today: ISODate, t: TFunction, lang: string): string {
  if (status === 'done' && d.doneAt != null) return t('deadlines.due.done', { date: formatTimestamp(d.doneAt, lang) })
  const days = diffDays(today, d.date)
  if (days < 0) return t('deadlines.due.overdue', { count: -days })
  if (days === 0) return t('deadlines.due.today')
  return t('deadlines.due.in', { count: days })
}

export function repeatLabel(d: Deadline, t: TFunction): string | null {
  if (!isRecurring(d)) return null
  return t(`deadlines.repeats.${d.recurrence.unit}`, { count: d.recurrence.every })
}

/** Primo giorno della settimana per la lingua (1 = lunedì, 7 = domenica). */
export function firstDayOfWeek(lang: string): number {
  try {
    const loc = new Intl.Locale(lang) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    return loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay ?? 1
  } catch {
    return 1
  }
}
