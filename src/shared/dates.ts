/**
 * Date di calendario (senza orario) nel formato YYYY-MM-DD. I calcoli usano
 * "numeri di giorno" in UTC, così l'ora legale non sposta mai una data.
 */
export type ISODate = string

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

export function isValidISODate(s: string): boolean {
  const m = ISO_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}

export function parseISODate(s: ISODate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(s)
  if (!m) throw new Error(`Data non valida: ${s}`)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

export function formatISODate(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Data locale di un istante (il "oggi" dell'utente). */
export function toISODate(date: Date): ISODate {
  return formatISODate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 30
}

export function dayNumber(s: ISODate): number {
  const { y, m, d } = parseISODate(s)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

export function fromDayNumber(n: number): ISODate {
  const dt = new Date(n * DAY_MS)
  return formatISODate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

export function addDays(s: ISODate, n: number): ISODate {
  return fromDayNumber(dayNumber(s) + n)
}

/** Giorni da `a` a `b` (positivo se `b` è dopo `a`). */
export function diffDays(a: ISODate, b: ISODate): number {
  return dayNumber(b) - dayNumber(a)
}

/**
 * Aggiunge mesi mantenendo il giorno "di riferimento": una scadenza del 31
 * diventa il 30 o il 28/29 nei mesi più corti e torna al 31 quando il mese lo permette.
 */
export function addMonths(s: ISODate, n: number, anchorDay?: number): ISODate {
  const { y, m, d } = parseISODate(s)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const day = Math.min(anchorDay ?? d, daysInMonth(ny, nm))
  return formatISODate(ny, nm, day)
}

/** Giorno della settimana (0 = domenica … 6 = sabato). */
export function weekday(s: ISODate): number {
  return new Date(dayNumber(s) * DAY_MS).getUTCDay()
}
