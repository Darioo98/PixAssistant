import { z } from 'zod'
import { addDays, addMonths, diffDays, isValidISODate, toISODate, weekday, type ISODate } from './dates'
import { isoDate } from './deadlines'
import type { SyncItem } from './sync'

// ======================= Note =======================

export const noteSchema = z.object({
  title: z.string().max(200),
  body: z.string().max(200_000),
  pinned: z.boolean()
})
export type Note = z.infer<typeof noteSchema>
export type NoteItem = SyncItem<Note>

/** Titolo mostrato: quello scritto o la prima riga del testo. */
export function noteTitle(n: Pick<Note, 'title' | 'body'>, fallback: string): string {
  if (n.title.trim()) return n.title.trim()
  const first = n.body.trim().split(/\r?\n/)[0]?.replace(/^#+\s*/, '') ?? ''
  return first.slice(0, 80) || fallback
}

// ======================= To-do =======================

export const PRIORITIES = ['low', 'normal', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

export const todoSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  done: z.boolean(),
  doneAt: z.number().nullable(),
  due: isoDate.nullable(),
  priority: z.enum(PRIORITIES),
  /** Segnato per "oggi" anche senza data. */
  today: z.boolean()
})
export type Todo = z.infer<typeof todoSchema>
export type TodoItem = SyncItem<Todo>

/** Da fare oggi: segnato "oggi", oppure con data di oggi o passata. */
export function isTodoForToday(t: Todo, today: ISODate): boolean {
  if (t.done) return false
  return t.today || (t.due !== null && diffDays(t.due, today) >= 0)
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 }

/** Ordine: da fare prima, poi per data (le senza data in fondo), priorità e testo. */
export function compareTodos(a: Todo, b: Todo): number {
  if (a.done !== b.done) return a.done ? 1 : -1
  if (a.due !== b.due) {
    if (a.due === null) return 1
    if (b.due === null) return -1
    const d = diffDays(b.due, a.due)
    if (d !== 0) return d
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.text.localeCompare(b.text)
}

// ======================= Promemoria =======================

/** Data e ora locali "YYYY-MM-DDTHH:MM": restano le 15:00 anche con l'ora legale. */
export const localDateTime = z.string().refine((s) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(s)
  return Boolean(m && isValidISODate(m[1]!) && Number(m[2]) < 24 && Number(m[3]) < 60)
}, 'data/ora non valida')

export const REMINDER_REPEATS = ['none', 'day', 'weekdays', 'week', 'month'] as const
export type ReminderRepeat = (typeof REMINDER_REPEATS)[number]

export const reminderSchema = z.object({
  text: z.string().trim().min(1).max(500),
  /** Prossima occorrenza (ora locale). */
  at: localDateTime,
  repeat: z.enum(REMINDER_REPEATS),
  /** Giorno del mese originale per le ripetizioni mensili. */
  anchorDay: z.number().int().min(1).max(31),
  /** Posticipato fino a questo istante (ms). */
  snoozedUntil: z.number().nullable(),
  /** Promemoria singolo già mostrato. */
  done: z.boolean()
})
export type Reminder = z.infer<typeof reminderSchema>
export type ReminderItem = SyncItem<Reminder>

export function parseLocal(at: string): Date {
  const [d, t] = at.split('T') as [string, string]
  const [y, mo, day] = d.split('-').map(Number) as [number, number, number]
  const [h, mi] = t.split(':').map(Number) as [number, number]
  return new Date(y, mo - 1, day, h, mi, 0, 0)
}

export function formatLocal(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${toISODate(date)}T${hh}:${mm}`
}

/** Occorrenza successiva a `at` (una sola ripetizione). */
export function stepReminder(at: string, repeat: ReminderRepeat, anchorDay: number): string {
  const [d, time] = at.split('T') as [ISODate, string]
  let next: ISODate
  switch (repeat) {
    case 'day':
      next = addDays(d, 1)
      break
    case 'weekdays':
      next = addDays(d, 1)
      while (weekday(next) === 0 || weekday(next) === 6) next = addDays(next, 1)
      break
    case 'week':
      next = addDays(d, 7)
      break
    case 'month':
      next = addMonths(d, 1, anchorDay)
      break
    case 'none':
      return at
  }
  return `${next}T${time}`
}

/** Momento in cui il promemoria va mostrato (tiene conto del posticipo), o null se concluso. */
export function reminderDueAt(r: Reminder): number | null {
  if (r.done) return null
  return Math.max(parseLocal(r.at).getTime(), r.snoozedUntil ?? 0)
}

/**
 * Dopo che il promemoria è stato mostrato: i singoli si chiudono, i ripetuti
 * passano alla prima occorrenza futura (le occorrenze perse a PC spento non
 * vengono riproposte una per una).
 */
export function afterFired(r: Reminder, now: number): Reminder {
  if (r.repeat === 'none') return { ...r, done: true, snoozedUntil: null }
  let at = r.at
  for (let i = 0; i < 5000 && parseLocal(at).getTime() <= now; i++) at = stepReminder(at, r.repeat, r.anchorDay)
  return { ...r, at, snoozedUntil: null }
}

// ======================= Timer e Pomodoro =======================

export type PomodoroPhase = 'work' | 'short' | 'long'

export interface PomodoroConfig {
  work: number
  short: number
  long: number
  /** Dopo quanti cicli di lavoro arriva la pausa lunga. */
  longEvery: number
}

/** Fase successiva: dopo il lavoro una pausa (lunga ogni N cicli), dopo una pausa si lavora. */
export function nextPomodoro(phase: PomodoroPhase, completedWork: number, cfg: PomodoroConfig): { phase: PomodoroPhase; completedWork: number } {
  if (phase !== 'work') return { phase: 'work', completedWork }
  const done = completedWork + 1
  return { phase: done % cfg.longEvery === 0 ? 'long' : 'short', completedWork: done }
}

export function phaseMinutes(phase: PomodoroPhase, cfg: PomodoroConfig): number {
  return phase === 'work' ? cfg.work : phase === 'short' ? cfg.short : cfg.long
}

export type TimerState = 'running' | 'paused' | 'waiting' | 'done'

export interface TimerView {
  id: string
  kind: 'pomodoro' | 'custom'
  label: string
  phase?: PomodoroPhase
  completedWork: number
  durationMs: number
  state: TimerState
  /** Fine prevista (solo in corso). */
  endsAt: number | null
  /** Tempo rimasto (in pausa). */
  remainingMs: number
}

export function remainingOf(t: TimerView, now: number): number {
  return t.state === 'running' && t.endsAt ? Math.max(0, t.endsAt - now) : t.remainingMs
}

export function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
}

// ======================= Operazioni (validate nel main) =======================

const id = z.string().min(1).max(200)

export const noteOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('save'), id: id.optional(), note: noteSchema }),
  z.object({ op: z.literal('remove'), id })
])

export const todoOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('save'),
    id: id.optional(),
    todo: todoSchema.pick({ text: true, due: true, priority: true, today: true })
  }),
  z.object({ op: z.literal('toggle'), id }),
  z.object({ op: z.literal('remove'), id }),
  z.object({ op: z.literal('clearDone') })
])

export const reminderOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('save'), id: id.optional(), text: reminderSchema.shape.text, at: localDateTime, repeat: z.enum(REMINDER_REPEATS) }),
  z.object({ op: z.literal('remove'), id }),
  z.object({ op: z.literal('snooze'), id, minutes: z.number().int().min(1).max(10_080) })
])

export const timerOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('startPomodoro') }),
  z.object({ op: z.literal('startCustom'), label: z.string().max(100), minutes: z.number().min(0.1).max(24 * 60) }),
  z.object({ op: z.literal('pause'), id }),
  z.object({ op: z.literal('resume'), id }),
  z.object({ op: z.literal('next'), id }),
  z.object({ op: z.literal('cancel'), id })
])

export type NoteOp = z.infer<typeof noteOpSchema>
export type TodoOp = z.infer<typeof todoOpSchema>
export type ReminderOp = z.infer<typeof reminderOpSchema>
export type TimerOp = z.infer<typeof timerOpSchema>

