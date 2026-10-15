/**
 * Icone di Pix: morbide e arrotondate, come la mascotte. Tratto pieno con le
 * estremità tonde e una tinta leggera all'interno, nel colore del testo (che
 * nelle sezioni attive è quello di Pix). Griglia 24×24.
 */
interface Shape {
  /** Riempimento leggero (tinta). */
  tint?: string
  /** Contorno. */
  line: string
}

const doc = 'M6.5 3.5h7.5l5 5v10a2.5 2.5 0 0 1-2.5 2.5h-10A2.5 2.5 0 0 1 4 18.5V6a2.5 2.5 0 0 1 2.5-2.5z'
const circle = (cx: number, cy: number, r: number) => `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}z`
const square = (x: number, y: number, s: number, r = 1.5) =>
  `M${x + r} ${y}h${s - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${s - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(s - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(s - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`

const ICONS = {
  search: { tint: circle(10.5, 10.5, 6.5), line: `${circle(10.5, 10.5, 6.5)}M15.5 15.5 20 20` },
  close: { line: 'M6.5 6.5l11 11M17.5 6.5l-11 11' },
  cancel: { line: 'M7 7l10 10M17 7 7 17' },
  home: {
    tint: 'M4.5 10.5 12 4l7.5 6.5V18a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 18z',
    line: 'M4.5 10.5 12 4l7.5 6.5V18a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 18zM10 20.5v-4a2 2 0 0 1 4 0v4'
  },
  calendar: {
    tint: 'M6.5 5h11A2.5 2.5 0 0 1 20 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-11A2.5 2.5 0 0 1 6.5 5z',
    line: 'M6.5 5h11A2.5 2.5 0 0 1 20 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-11A2.5 2.5 0 0 1 6.5 5zM4 10h16M8.5 3v4M15.5 3v4M8.5 15h.01M12 15h.01M15.5 15h.01'
  },
  lock: {
    tint: 'M7.5 10h9a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-6A2.5 2.5 0 0 1 7.5 10z',
    line: 'M7.5 10h9a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-6A2.5 2.5 0 0 1 7.5 10zM8 10V7.5a4 4 0 0 1 8 0V10M12 14.5v2'
  },
  chat: {
    tint: 'M6 4.5h12A2.5 2.5 0 0 1 20.5 7v7.5A2.5 2.5 0 0 1 18 17h-6l-4.5 3.5V17H6a2.5 2.5 0 0 1-2.5-2.5V7A2.5 2.5 0 0 1 6 4.5z',
    line: 'M6 4.5h12A2.5 2.5 0 0 1 20.5 7v7.5A2.5 2.5 0 0 1 18 17h-6l-4.5 3.5V17H6a2.5 2.5 0 0 1-2.5-2.5V7A2.5 2.5 0 0 1 6 4.5zM8 9.5h8M8 13h5'
  },
  note: { tint: doc, line: `${doc}M13.5 3.5V7a1.5 1.5 0 0 0 1.5 1.5h4M8 13h8M8 16.5h5` },
  document: { tint: doc, line: `${doc}M13.5 3.5V7a1.5 1.5 0 0 0 1.5 1.5h4M8 12.5h8M8 16h8` },
  pdf: { tint: doc, line: `${doc}M13.5 3.5V7a1.5 1.5 0 0 0 1.5 1.5h4M8 13h6.5a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V14a1 1 0 0 1 1-1z` },
  stopwatch: { tint: circle(12, 13.5, 7.5), line: `${circle(12, 13.5, 7.5)}M12 10v3.5l2.5 1.5M10 2.5h4M18.5 6.5l1.5-1.5` },
  clipboard: {
    tint: 'M7 5h10a2 2 0 0 1 2 2v11.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5V7a2 2 0 0 1 2-2z',
    line: 'M8 5H7a2 2 0 0 0-2 2v11.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V7a2 2 0 0 0-2-2h-1M9.5 3.5h5a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1zM8.5 12h7M8.5 15.5h4.5'
  },
  link: { line: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' },
  settings: {
    tint: `${circle(14, 7, 2.3)}${circle(10, 17, 2.3)}`,
    line: `M4.5 7h7.2M16.3 7h3.2M4.5 17h3.2M12.3 17h7.2${circle(14, 7, 2.3)}${circle(10, 17, 2.3)}`
  },
  pinned: { tint: 'M9 3.5h6l-.8 5 3.3 3.3V13H6.5v-1.2l3.3-3.3z', line: 'M9 3.5h6l-.8 5 3.3 3.3V13H6.5v-1.2l3.3-3.3zM12 13v7.5' },
  check: { line: 'M5 12.5l4.5 4.5L19 7.5' },
  todo: { tint: square(4, 4, 16, 3.5), line: `${square(4, 4, 16, 3.5)}M8.5 12l2.5 2.5 4.5-5` },
  clock: { tint: circle(12, 12, 8.5), line: `${circle(12, 12, 8.5)}M12 7.5V12l3 2` },
  reminder: {
    tint: 'M12 3.5a5.5 5.5 0 0 1 5.5 5.5v3.5l1.5 3.5H5l1.5-3.5V9A5.5 5.5 0 0 1 12 3.5z',
    line: 'M12 3.5a5.5 5.5 0 0 1 5.5 5.5v3.5l1.5 3.5H5l1.5-3.5V9A5.5 5.5 0 0 1 12 3.5zM10 19.5a2 2 0 0 0 4 0'
  },
  key: { tint: circle(8, 15.5, 4.2), line: `${circle(8, 15.5, 4.2)}M11 12.5 19.5 4M16.3 7.2l2.2 2.2M13.8 9.7l1.6 1.6` },
  folder: {
    tint: 'M6 5h3.5l2 2.5H18A2.5 2.5 0 0 1 20.5 10v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-10A2.5 2.5 0 0 1 6 5z',
    line: 'M6 5h3.5l2 2.5H18A2.5 2.5 0 0 1 20.5 10v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-10A2.5 2.5 0 0 1 6 5z'
  },
  folderOpen: {
    tint: 'M5.8 11.4A2 2 0 0 1 7.7 10h12a1.5 1.5 0 0 1 1.4 2l-1.9 5.6A3.5 3.5 0 0 1 16 20H6a2.5 2.5 0 0 1-2.4-3.2z',
    line: 'M3.5 17.5v-10A2.5 2.5 0 0 1 6 5h3.5l2 2.5H17a2.5 2.5 0 0 1 2.5 2.5M5.8 11.4A2 2 0 0 1 7.7 10h12a1.5 1.5 0 0 1 1.4 2l-1.9 5.6A3.5 3.5 0 0 1 16 20H6a2.5 2.5 0 0 1-2.4-3.2z'
  },
  work: {
    tint: 'M6 7.5h12a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5V10A2.5 2.5 0 0 1 6 7.5z',
    line: 'M6 7.5h12a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5V10A2.5 2.5 0 0 1 6 7.5zM9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17M12 12v2'
  },
  picture: {
    tint: square(3.5, 4.5, 17, 3),
    line: `${square(3.5, 4.5, 17, 3)}M4 17l4.5-4.5 3 3 3-3.5 5 5${circle(15.5, 9, 1.5)}`
  },
  pause: { line: 'M9 6.5v11M15 6.5v11' },
  chevronDown: { line: 'M6 9.5l6 6 6-6' },
  chevronUp: { line: 'M6 14.5l6-6 6 6' },
  chevronRight: { line: 'M9.5 6l6 6-6 6' },
  chevronLeft: { line: 'M14.5 6l-6 6 6 6' },
  user: { tint: `${circle(12, 8, 4)}M4.5 20a7.5 6 0 0 1 15 0z`, line: `${circle(12, 8, 4)}M4.5 20a7.5 6 0 0 1 15 0` },
  emoji: { tint: circle(12, 12, 8.5), line: `${circle(12, 12, 8.5)}M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01` },
  apps: {
    tint: `${square(4, 4, 7, 2)}${square(13, 4, 7, 2)}${square(4, 13, 7, 2)}${square(13, 13, 7, 2)}`,
    line: `${square(4, 4, 7, 2)}${square(13, 4, 7, 2)}${square(4, 13, 7, 2)}${square(13, 13, 7, 2)}`
  },
  save: {
    tint: 'M4.5 9h15v8.5A2.5 2.5 0 0 1 17 20H7a2.5 2.5 0 0 1-2.5-2.5z',
    line: 'M4.5 9h15v8.5A2.5 2.5 0 0 1 17 20H7a2.5 2.5 0 0 1-2.5-2.5zM5 4h14a1.5 1.5 0 0 1 1.5 1.5v2A1.5 1.5 0 0 1 19 9H5a1.5 1.5 0 0 1-1.5-1.5v-2A1.5 1.5 0 0 1 5 4zM10 13h4'
  },
  mapPin: {
    tint: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z',
    line: `M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z${circle(12, 10, 2.3)}`
  }
} satisfies Record<string, Shape>

export type GlyphName = keyof typeof ICONS

export function Glyph({ name, size = 16, className = '', color }: { name: GlyphName; size?: number; className?: string; color?: string }) {
  const icon: Shape = ICONS[name]
  return (
    <svg
      className={`glyph ${className}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={color ? { color } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 12 ? 2.4 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon.tint && <path d={icon.tint} fill="currentColor" stroke="none" opacity="0.2" />}
      <path d={icon.line} />
    </svg>
  )
}
