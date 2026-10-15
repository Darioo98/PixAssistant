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
  pixTransforms: z.boolean(),
  eyesFollowCursor: z.boolean(),
  bubbleSeconds: z.number().int().min(3).max(120),
  defaultLeadDays: z.number().int().min(0).max(365),
  shiftWorkMinutes: z.number().int().min(15).max(16 * 60),
  shiftBreakMinutes: z.number().int().min(0).max(240),
  shiftRemindBefore: z.number().int().min(0).max(120),
  weatherCity: z.string().max(100),
  pomoWork: z.number().int().min(1).max(180),
  pomoShort: z.number().int().min(1).max(60),
  pomoLong: z.number().int().min(1).max(120),
  pomoLongEvery: z.number().int().min(2).max(12),
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
  /** Scorciatoia globale della ricerca. */
  searchShortcut: z.string().min(1).max(64),
  mascotHidden: z.boolean(),
  notificationsPaused: z.boolean(),
  hideInFullscreen: z.boolean(),
  clipboardPaused: z.boolean(),
  clipboardMax: z.number().int().min(5).max(500),
  clipboardImages: z.boolean(),
  clipboardExcluded: z.string().max(2000),
  /** Cartella dati scelta a mano; stringa vuota = rilevamento automatico di OneDrive. */
  dataDir: z.string().max(1024)
})

export type Settings = z.infer<typeof settingsSchema>
export type SettingKey = keyof Settings

export const LOCAL_KEYS = [
  'autostart',
  'shortcut',
  'searchShortcut',
  'mascotHidden',
  'notificationsPaused',
  'hideInFullscreen',
  'clipboardPaused',
  'clipboardMax',
  'clipboardImages',
  'clipboardExcluded',
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
  pixTransforms: true,
  eyesFollowCursor: true,
  bubbleSeconds: 12,
  defaultLeadDays: 3,
  shiftWorkMinutes: 480,
  shiftBreakMinutes: 60,
  shiftRemindBefore: 15,
  weatherCity: '',
  pomoWork: 25,
  pomoShort: 5,
  pomoLong: 15,
  pomoLongEvery: 4,
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
  searchShortcut: 'Control+Alt+F',
  mascotHidden: false,
  notificationsPaused: false,
  hideInFullscreen: true,
  clipboardPaused: false,
  clipboardMax: 50,
  clipboardImages: true,
  clipboardExcluded: 'KeePass.exe, KeePassXC.exe, 1Password.exe, Bitwarden.exe',
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
