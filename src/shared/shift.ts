import { z } from 'zod'
import { isValidISODate, type ISODate } from './dates'

/**
 * Turno di lavoro in sede: dall'ora di arrivo, la durata e la pausa si
 * calcola l'ora di fine e quanto manca.
 */

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const shiftSchema = z.object({
  date: z.string().refine(isValidISODate),
  /** Ora di arrivo "HH:MM". */
  arrival: hhmm,
  /** Minuti di lavoro previsti (senza pausa). */
  workMinutes: z.number().int().min(15).max(16 * 60),
  /** Minuti di pausa (es. pranzo). */
  breakMinutes: z.number().int().min(0).max(240)
})
export type Shift = z.infer<typeof shiftSchema>

export interface ShiftState {
  shift: Shift | null
  /** Primo momento in cui hai usato il PC oggi ("HH:MM"), per proporre l'ora di arrivo. */
  suggestedArrival: string
  /** Fine turno (ms) se il turno di oggi è iniziato. */
  endsAt: number | null
}

export const shiftOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('start'), arrival: hhmm, breakMinutes: z.number().int().min(0).max(240).optional() }),
  z.object({ op: z.literal('adjust'), arrival: hhmm.optional(), breakMinutes: z.number().int().min(0).max(240).optional() }),
  z.object({ op: z.literal('clear') })
])
export type ShiftOp = z.infer<typeof shiftOpSchema>

export function minutesOf(hhmmValue: string): number {
  const [h, m] = hhmmValue.split(':').map(Number) as [number, number]
  return h * 60 + m
}

export function formatHHMM(totalMinutes: number): string {
  const m = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Istante di fine turno (ora locale): arrivo + lavoro + pausa. */
export function shiftEnd(s: Shift): Date {
  const [y, mo, d] = s.date.split('-').map(Number) as [number, number, number]
  const start = new Date(y, mo - 1, d, 0, 0, 0, 0)
  start.setMinutes(minutesOf(s.arrival) + s.workMinutes + s.breakMinutes)
  return start
}

export function shiftStart(s: Shift): Date {
  const [y, mo, d] = s.date.split('-').map(Number) as [number, number, number]
  const start = new Date(y, mo - 1, d, 0, 0, 0, 0)
  start.setMinutes(minutesOf(s.arrival))
  return start
}

/** Avanzamento 0–1 del turno. */
export function shiftProgress(s: Shift, now: number): number {
  const start = shiftStart(s).getTime()
  const end = shiftEnd(s).getTime()
  return Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)))
}

/** "2 h 13 min" / "45 min": durata leggibile (arrotondata al minuto per eccesso). */
export function formatRemaining(ms: number, labels: { h: string; min: string }): string {
  const total = Math.max(0, Math.ceil(ms / 60_000))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} ${labels.min}`
  return m === 0 ? `${h} ${labels.h}` : `${h} ${labels.h} ${m} ${labels.min}`
}

export function isToday(s: Shift | null, today: ISODate): s is Shift {
  return s !== null && s.date === today
}
