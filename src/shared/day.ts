import { diffDays, type ISODate } from './dates'
import { deadlineStatus, type Deadline } from './deadlines'
import { isTodoForToday, parseLocal, type Reminder, type Todo } from './productivity'

/**
 * Logica della giornata di Pix: tensione per le scadenze vicine e
 * riepilogo del mattino. Funzioni pure, verificabili nei test.
 */

/** Pix è un po' teso se c'è una scadenza scaduta, di oggi o di domani, o un to-do in ritardo. */
export function hasTension(deadlines: Deadline[], todos: Todo[], today: ISODate): boolean {
  const urgent = deadlines.some((d) => {
    const status = deadlineStatus(d, today, 0)
    if (status === 'done') return false
    if (d.snoozedUntil && diffDays(today, d.snoozedUntil) > 0) return false
    return diffDays(today, d.date) <= 1
  })
  return urgent || todos.some((t) => !t.done && t.due !== null && diffDays(t.due, today) > 0)
}

/** Da quale ora si mostra il riepilogo del mattino (prima è notte fonda). */
export const SUMMARY_FROM_HOUR = 5

export interface SummaryInput {
  now: Date
  deadlines: Deadline[]
  todos: Todo[]
  reminders: Reminder[]
  /** Fine del turno di oggi (ms), se iniziato. */
  shiftEndsAt: number | null
  weather: { city: string; temperature: number; min: number; max: number; icon: string } | null
}

type T = (key: string, options?: Record<string, unknown>) => string

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** Testo del riepilogo: saluto, turno, scadenze, to-do, promemoria e meteo (una riga ciascuno). */
export function buildSummary(input: SummaryInput, today: ISODate, t: T): string {
  const h = input.now.getHours()
  const lines = [t(h < 12 ? 'day.summary.morning' : h < 18 ? 'day.summary.afternoon' : 'day.summary.evening')]

  if (input.shiftEndsAt) lines.push(t('day.summary.shift', { time: hhmm(new Date(input.shiftEndsAt)) }))

  const due = input.deadlines.filter((d) => {
    const s = deadlineStatus(d, today, 0)
    return s === 'today' || s === 'overdue'
  })
  if (due.length) {
    const names = due.slice(0, 2).map((d) => d.title).join(', ')
    lines.push(t('day.summary.deadlines', { count: due.length, names: due.length > 2 ? `${names}…` : names }))
  } else lines.push(t('day.summary.noDeadlines'))

  const todos = input.todos.filter((x) => isTodoForToday(x, today)).length
  if (todos) lines.push(t('day.summary.todos', { count: todos }))

  const end = new Date(input.now)
  end.setHours(23, 59, 59, 999)
  const reminders = input.reminders
    .filter((r) => !r.done)
    .map((r) => ({ r, at: parseLocal(r.at) }))
    .filter(({ at }) => at.getTime() >= input.now.getTime() && at.getTime() <= end.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  if (reminders.length) {
    const first = reminders[0]!
    lines.push(t('day.summary.reminders', { count: reminders.length, more: reminders.length - 1, time: hhmm(first.at), text: first.r.text }))
  }

  if (input.weather) {
    const w = input.weather
    lines.push(t('day.summary.weather', { icon: w.icon, city: w.city, temp: Math.round(w.temperature), min: Math.round(w.min), max: Math.round(w.max) }))
  }
  return lines.join('\n')
}

/** Giornata con tutti i to-do di oggi completati (dopo averne avuto almeno uno). */
export function todosLeftToday(todos: Todo[], today: ISODate): number {
  return todos.filter((x) => isTodoForToday(x, today)).length
}
