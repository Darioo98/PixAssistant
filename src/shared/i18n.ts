import it from './locales/it.json'
import en from './locales/en.json'

export const LANGS = ['it', 'en'] as const
export type Lang = (typeof LANGS)[number]

export const resources = { it: { translation: it }, en: { translation: en } } as const

/** Lingua effettiva: quella scelta, oppure la prima lingua di Windows supportata (fallback: italiano). */
export function resolveLang(setting: 'system' | Lang, systemLocales: readonly string[]): Lang {
  if (setting !== 'system') return setting
  for (const loc of systemLocales) {
    const base = loc.toLowerCase().split(/[-_]/)[0]
    if ((LANGS as readonly string[]).includes(base ?? '')) return base as Lang
  }
  return 'it'
}
