import { z } from 'zod'
import { HEX_COLOR, PIX_EYES, PIX_FINISHES, PIX_SHAPES } from './mascot'

/**
 * Impostazioni dell'app. Alcune valgono per tutti i PC e si sincronizzano,
 * altre dipendono dal singolo PC e restano solo in locale.
 */
export const settingsSchema = z.object({
  // Condivise (sincronizzate su OneDrive)
  language: z.enum(['system', 'it', 'en']),
  theme: z.enum(['system', 'light', 'dark']),
  closeOnBlur: z.boolean(),
  closeOnMouseLeave: z.boolean(),
  animations: z.enum(['off', 'low', 'normal']),
  mascotSize: z.enum(['small', 'medium', 'large']),
  pixShape: z.enum(PIX_SHAPES),
  pixColor: z.string().regex(HEX_COLOR),
  pixEyes: z.enum(PIX_EYES),
  pixFinish: z.enum(PIX_FINISHES),
  pixShine: z.boolean(),
  eyesFollowCursor: z.boolean(),
  bubbleSeconds: z.number().int().min(3).max(120),
  defaultLeadDays: z.number().int().min(0).max(365),
  aiProvider: z.enum(['claude-subscription']),
  aiModel: z.string().min(1).max(100),
  vaultSessionHours: z.number().int().min(1).max(72),
  genLength: z.number().int().min(8).max(128),
  genSymbols: z.boolean(),
  genAvoidAmbiguous: z.boolean(),
  dndEnabled: z.boolean(),
  dndFrom: z.string().regex(/^\d{2}:\d{2}$/),
  dndTo: z.string().regex(/^\d{2}:\d{2}$/),

  // Solo locali (legate a questo PC)
  autostart: z.boolean(),
  shortcut: z.string().min(1).max(64),
  mascotHidden: z.boolean(),
  notificationsPaused: z.boolean(),
  hideInFullscreen: z.boolean(),
  /** Cartella dati scelta a mano; stringa vuota = rilevamento automatico di OneDrive. */
  dataDir: z.string().max(1024)
})

export type Settings = z.infer<typeof settingsSchema>
export type SettingKey = keyof Settings

export const LOCAL_KEYS = [
  'autostart',
  'shortcut',
  'mascotHidden',
  'notificationsPaused',
  'hideInFullscreen',
  'dataDir'
] as const satisfies readonly SettingKey[]

export type LocalKey = (typeof LOCAL_KEYS)[number]
export type SyncedKey = Exclude<SettingKey, LocalKey>

export function isLocalKey(key: string): key is LocalKey {
  return (LOCAL_KEYS as readonly string[]).includes(key)
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'system',
  theme: 'system',
  closeOnBlur: true,
  closeOnMouseLeave: false,
  animations: 'normal',
  mascotSize: 'medium',
  pixShape: 'squircle',
  pixColor: '#6366F1',
  pixEyes: 'pill',
  pixFinish: 'flat',
  pixShine: true,
  eyesFollowCursor: true,
  bubbleSeconds: 12,
  defaultLeadDays: 3,
  aiProvider: 'claude-subscription',
  aiModel: 'default',
  vaultSessionHours: 8,
  genLength: 20,
  genSymbols: true,
  genAvoidAmbiguous: true,
  dndEnabled: false,
  dndFrom: '22:00',
  dndTo: '07:00',
  autostart: true,
  shortcut: 'Control+Alt+Space',
  mascotHidden: false,
  notificationsPaused: false,
  hideInFullscreen: true,
  dataDir: ''
}

export const settingsPatchSchema = settingsSchema.partial().strict()
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

/**
 * Costruisce le impostazioni a partire da valori grezzi (file locali o sincronizzati),
 * scartando chiave per chiave i valori non validi invece di perdere tutto.
 */
export function coerceSettings(raw: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  const shape = settingsSchema.shape
  for (const key of Object.keys(shape) as SettingKey[]) {
    if (!(key in raw)) continue
    const parsed = shape[key].safeParse(raw[key])
    if (parsed.success) out[key] = parsed.data
  }
  return out as Settings
}
