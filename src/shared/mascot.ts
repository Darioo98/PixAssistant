/** Stati di Pix, colori e fumetti: logica pura condivisa tra main e renderer. */

export const MOODS = ['normal', 'alert', 'happy', 'sleep', 'think', 'greet'] as const
export type Mood = (typeof MOODS)[number]

export const MOOD_COLORS: Record<Mood, string> = {
  normal: '#6366F1',
  alert: '#F97362',
  happy: '#22B07D',
  sleep: '#5B6687',
  think: '#6366F1',
  greet: '#6366F1'
}

export interface BubbleAction {
  id: string
  label: string
  primary?: boolean
}

export interface Bubble {
  id: string
  /** Categoria già tradotta (es. "Scadenze"). */
  category: string
  /** Momento dell'avviso (ms epoch), mostrato come "ora" o come orario. */
  time: number
  text: string
  actions: BubbleAction[]
  /** Se true Pix passa allo stato "avviso" mentre il fumetto è visibile. */
  alert: boolean
  timeoutMs: number
}

export type BubbleOutcome = { kind: 'action'; actionId: string } | { kind: 'dismiss' } | { kind: 'timeout' }

export interface MascotState {
  mood: Mood
  bubble: Bubble | null
  queued: number
  /** Stato momentaneo in corso (saluto, festa, anteprima): Pix si mostra anche da chiuso. */
  spotlight: boolean
}

export const MASCOT_SCALE = { small: 0.85, medium: 1, large: 1.2 } as const
export type MascotSize = keyof typeof MASCOT_SCALE

/** Priorità degli stati: avviso > pensa > stati momentanei (felice, saluto) > dorme > normale. */
export function resolveMood(input: {
  bubbleAlert: boolean
  thinking: boolean
  transient: Mood | null
  asleep: boolean
}): Mood {
  if (input.bubbleAlert) return 'alert'
  if (input.thinking) return 'think'
  if (input.transient) return input.transient
  if (input.asleep) return 'sleep'
  return 'normal'
}

function minutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** `true` se `now` cade nella fascia oraria [from, to), anche a cavallo della mezzanotte. */
export function inTimeRange(now: Date, from: string, to: string): boolean {
  const a = minutes(from)
  const b = minutes(to)
  if (a === null || b === null || a === b) return false
  const t = now.getHours() * 60 + now.getMinutes()
  return a < b ? t >= a && t < b : t >= a || t < b
}

/** Fascia notturna in cui Pix dorme quando "non disturbare" non è configurato. */
export const NIGHT = { from: '23:00', to: '07:00' } as const

/** Dopo quanti secondi di inattività del PC Pix si addormenta. */
export const SLEEP_AFTER_IDLE_S = 15 * 60
