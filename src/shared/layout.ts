/**
 * Geometria della finestra trasparente. La finestra ha una dimensione fissa
 * (abbastanza grande da contenere pannello, Pix e fumetto) ed è ancorata
 * all'angolo in basso a destra dell'area di lavoro dello schermo principale.
 * Le zone trasparenti lasciano passare i clic (vedi hit-test nel renderer).
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const LAYOUT = {
  panelWidth: 420,
  panelHeight: 650,
  /** Colonna a destra del pannello dove vivono barra e Pix. */
  pixColumn: 96,
  margin: 12,
  barWidth: 8,
  barHeight: 180,
  /** Area sensibile al passaggio del mouse, più larga della barra. */
  barHitWidth: 24,
  /** Distanza della barra dal fondo dell'area di lavoro. */
  barBottom: 40,
  pixSize: 60
} as const

export function windowBounds(workArea: Rect, shift = 0): Rect {
  const width = Math.min(LAYOUT.panelWidth + LAYOUT.pixColumn + LAYOUT.margin, workArea.width)
  const height = Math.min(LAYOUT.panelHeight + 2 * LAYOUT.margin, workArea.height)
  return {
    x: Math.round(workArea.x + workArea.width - width),
    y: Math.round(workArea.y + workArea.height - height - shift),
    width: Math.round(width),
    height: Math.round(height)
  }
}

/** Distanza minima della cima della barra dalla cima dello schermo. */
const BAR_TOP_GAP = 10

/**
 * Barra spostata in su di `lift` px rispetto alla posizione di base. Si alza
 * prima la finestra (finché resta dentro lo schermo), poi si sposta Pix
 * dentro la finestra (`inner`): così la barra arriva fino in cima.
 */
export function splitLift(workArea: Rect, lift: number): { lift: number; shift: number; inner: number } {
  const height = Math.min(LAYOUT.panelHeight + 2 * LAYOUT.margin, workArea.height)
  const maxLift = Math.max(0, workArea.height - LAYOUT.barBottom - LAYOUT.barHeight - BAR_TOP_GAP)
  const l = Math.round(Math.min(maxLift, Math.max(0, lift)))
  const shift = Math.min(l, Math.max(0, workArea.height - height))
  return { lift: l, shift, inner: l - shift }
}

/** Confronto con tolleranza: con scale DPI non intere Windows arrotonda di 1 px. */
export function sameRect(a: Rect, b: Rect, tolerance = 1): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  )
}
