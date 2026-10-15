/**
 * Icone di sistema di Windows: lo stesso font di Impostazioni ed Esplora file
 * ("Segoe Fluent Icons" su Windows 11, "Segoe MDL2 Assets" su Windows 10),
 * così Pix ha l'aspetto di un'app nativa. Niente emoji nell'interfaccia.
 */
const CODES = {
  search: '',
  close: '',
  cancel: '',
  home: '',
  calendar: '',
  lock: '',
  chat: '',
  note: '',
  stopwatch: '',
  clipboard: '',
  link: '',
  settings: '',
  pinned: '',
  check: '',
  todo: '',
  clock: '',
  reminder: '',
  key: '',
  folder: '',
  folderOpen: '',
  work: '',
  document: '',
  pdf: '',
  picture: '',
  pause: '',
  chevronDown: '',
  chevronRight: '',
  chevronLeft: '',
  chevronUp: '',
  user: '',
  emoji: '',
  apps: '',
  save: '',
  mapPin: ''
} as const

export type GlyphName = keyof typeof CODES

export function Glyph({ name, size = 16, className = '', color }: { name: GlyphName; size?: number; className?: string; color?: string }) {
  return (
    <span className={`glyph ${className}`} aria-hidden="true" style={{ fontSize: size, ...(color ? { color } : {}) }}>
      {CODES[name]}
    </span>
  )
}
