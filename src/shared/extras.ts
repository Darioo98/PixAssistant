import { z } from 'zod'
import type { SyncItem } from './sync'

// ======================= Cronologia appunti =======================

export interface ClipEntry {
  id: string
  kind: 'text' | 'image'
  /** Testo (solo per kind = text). */
  text?: string
  /** Anteprima ridotta (data URL) per le immagini. */
  thumb?: string
  width?: number
  height?: number
  /** App da cui è stato copiato (es. "chrome.exe"). */
  source: string
  at: number
  pinned: boolean
}

export interface ClipState {
  available: boolean
  paused: boolean
  entries: ClipEntry[]
}

/** App escluse: confronto per nome dell'eseguibile, senza maiuscole. */
export function isExcludedApp(owner: string, excluded: string): boolean {
  const name = owner.trim().toLowerCase()
  if (!name) return false
  return excluded
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((e) => e === name || `${e}.exe` === name)
}

/**
 * Aggiunge una voce in cima: se lo stesso testo c'è già, lo sposta in cima;
 * oltre il limite si eliminano le voci più vecchie non fissate.
 */
export function addClip(entries: ClipEntry[], entry: ClipEntry, max: number): { entries: ClipEntry[]; removed: ClipEntry[] } {
  const dup = entry.kind === 'text' ? entries.find((e) => e.kind === 'text' && e.text === entry.text) : undefined
  let list = dup ? entries.filter((e) => e !== dup) : entries
  list = [{ ...entry, pinned: dup?.pinned ?? entry.pinned }, ...list]
  const removed: ClipEntry[] = []
  let unpinned = list.filter((e) => !e.pinned).length
  for (let i = list.length - 1; i >= 0 && unpinned > max; i--) {
    if (!list[i]!.pinned) {
      removed.push(list[i]!)
      list.splice(i, 1)
      unpinned--
    }
  }
  return { entries: list, removed }
}

export const clipOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('copy'), id: z.string().max(200) }),
  z.object({ op: z.literal('pin'), id: z.string().max(200), pinned: z.boolean() }),
  z.object({ op: z.literal('remove'), id: z.string().max(200) }),
  z.object({ op: z.literal('clear') }),
  z.object({ op: z.literal('pause'), paused: z.boolean() })
])
export type ClipOp = z.infer<typeof clipOpSchema>

// ======================= Link e app rapide =======================

export const LINK_KINDS = ['web', 'app', 'folder'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

export const linkSchema = z.object({
  kind: z.enum(LINK_KINDS),
  title: z.string().trim().min(1).max(100),
  /** URL (web) o percorso sul PC (app, cartella). */
  target: z.string().trim().min(1).max(2000),
  order: z.number()
})
export type Link = z.infer<typeof linkSchema>
export type LinkItem = SyncItem<Link>

export interface LinkView extends LinkItem {
  /** Icona (data URL) se disponibile. */
  icon?: string
}

/** Normalizza un indirizzo web: aggiunge https:// e accetta solo http/https. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return u.toString()
  } catch {
    return null
  }
}

export const linkOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('save'), id: z.string().max(200).optional(), kind: z.enum(LINK_KINDS), title: z.string().trim().max(100), target: z.string().trim().min(1).max(2000) }),
  z.object({ op: z.literal('remove'), id: z.string().max(200) }),
  z.object({ op: z.literal('open'), id: z.string().max(200) }),
  z.object({ op: z.literal('reorder'), ids: z.array(z.string().max(200)).max(500) }),
  z.object({ op: z.literal('pick'), kind: z.enum(['app', 'folder']) })
])
export type LinkOp = z.infer<typeof linkOpSchema>

// ======================= Trascinare su Pix =======================

/** Cosa è stato lasciato cadere su Pix: percorsi di file/cartelle o testo (anche un indirizzo web). */
export const dropSchema = z.object({
  paths: z.array(z.string().min(3).max(1024)).max(20),
  text: z.string().max(100_000)
})
export type DropPayload = z.infer<typeof dropSchema>

/** Percorso assoluto di Windows (C:\… o \\server\…). */
export function isAbsoluteWinPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\[^\\]+\\/.test(p)
}

// ======================= Meteo (Open-Meteo) =======================

export interface WeatherView {
  city: string
  country?: string
  temperature: number
  code: number
  isDay: boolean
  days: Array<{ date: string; min: number; max: number; code: number }>
  updatedAt: number
}

export type WeatherState = { status: 'off' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; weather: WeatherView }

/** Codici meteo WMO → gruppo (per testo e icona). */
export function weatherKind(code: number): 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'storm' {
  if (code === 0) return 'clear'
  if (code === 1 || code === 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || code === 80 || code === 81 || code === 82) return code >= 80 ? 'showers' : 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'storm'
  return 'cloudy'
}

export const WEATHER_ICONS: Record<ReturnType<typeof weatherKind>, { day: string; night: string }> = {
  clear: { day: '☀️', night: '🌙' },
  partly: { day: '⛅', night: '☁️' },
  cloudy: { day: '☁️', night: '☁️' },
  fog: { day: '🌫️', night: '🌫️' },
  drizzle: { day: '🌦️', night: '🌧️' },
  rain: { day: '🌧️', night: '🌧️' },
  showers: { day: '🌦️', night: '🌧️' },
  snow: { day: '🌨️', night: '🌨️' },
  storm: { day: '⛈️', night: '⛈️' }
}
