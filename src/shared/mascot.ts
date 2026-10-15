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
  /** Pomodoro in corso: Pix dorme sulla barra e non disturba. */
  focus: boolean
  /** Scadenza vicina o to-do in ritardo: Pix è un po' preoccupato. */
  tension: boolean
  /** Gesto speciale in corso (es. saluto di fine turno), con l'istante in cui è partito. */
  gesture?: { kind: 'farewell'; at: number } | null
}

export const MASCOT_SCALE = { small: 0.85, medium: 1, large: 1.2 } as const
export type MascotSize = keyof typeof MASCOT_SCALE

/** Priorità degli stati: avviso > pensa > stati momentanei (felice, saluto) > focus/dorme > normale. */
export function resolveMood(input: {
  bubbleAlert: boolean
  thinking: boolean
  transient: Mood | null
  asleep: boolean
  focus?: boolean
}): Mood {
  if (input.bubbleAlert) return 'alert'
  if (input.thinking) return 'think'
  if (input.transient) return input.transient
  if (input.asleep || input.focus) return 'sleep'
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

// ---- Aspetto personalizzabile ----

export const PIX_SHAPES = ['squircle', 'round', 'tile', 'egg', 'soft'] as const
export type PixShape = (typeof PIX_SHAPES)[number]

export const PIX_EYES = ['pill', 'dot', 'wide'] as const
export type PixEyes = (typeof PIX_EYES)[number]

export const PIX_FINISHES = ['flat', 'gradient'] as const
export type PixFinish = (typeof PIX_FINISHES)[number]

/** Tavolozza proposta per il colore di base (stato normale). */
export const PIX_PALETTE = ['#6366F1', '#8B5CF6', '#3B82F6', '#0EA5E9', '#EC4899', '#F59E0B', '#475569'] as const

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * Colore del corpo per uno stato: normale, pensa e saluto usano il colore
 * scelto dall'utente; avviso, felice e dorme restano fissi perché comunicano qualcosa.
 */
export function moodColor(mood: Mood, base: string): string {
  if (mood === 'normal' || mood === 'think' || mood === 'greet') return HEX_COLOR.test(base) ? base : MOOD_COLORS.normal
  return MOOD_COLORS[mood]
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Mescola il colore con il bianco (amount 0–1). */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex).map((c) => Math.round(c + (255 - c) * amount)) as [number, number, number]
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/** Luminanza relativa (WCAG). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Occhi bianchi sui colori scuri, scuri sui colori chiari: sempre leggibili. */
export function eyeColorFor(body: string): string {
  return luminance(body) > 0.45 ? '#1F2033' : '#FFFFFF'
}

// ---- Trasformazioni del fluido ----

/** Animazioni del corpo di Pix (un unico fluido che si deforma e si muove). */
export const PIX_TRANSFORMS = ['wobble', 'waves', 'tentacles', 'heart', 'melt', 'shield', 'bubble', 'hourglass'] as const
export type PixTransform = (typeof PIX_TRANSFORMS)[number]

/** Animazioni legate allo stato: fumetto che parla mentre l'AI pensa, cuore quando festeggia. */
export function moodTransform(mood: Mood): PixTransform | null {
  if (mood === 'think') return 'bubble'
  if (mood === 'happy') return 'heart'
  return null
}

/** Sceglie un'animazione spontanea diversa dall'ultima fatta. */
export function pickTransform(last: PixTransform | null, random: () => number): PixTransform {
  const options = PIX_TRANSFORMS.filter((x) => x !== last)
  return options[Math.floor(random() * options.length) % options.length]!
}

/** Animazione con cui Pix accoglie ogni sezione del pannello. */
export const SECTION_ANIMATIONS: Record<string, PixTransform | null> = {
  home: 'wobble',
  deadlines: 'melt',
  vault: 'shield',
  chat: 'bubble',
  notes: 'waves',
  timers: 'hourglass',
  clipboard: 'tentacles',
  links: 'wobble',
  settings: null
}
