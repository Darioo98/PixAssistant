/**
 * Sbirciata a pannello chiuso: un piccolo Pix esce da dietro la barra come una
 * goccia che si stacca, guarda fuori con un occhio solo, poi si sporge, si
 * guarda intorno, sbatte le palpebre e rientra. Funzioni pure, così i
 * fotogrammi si possono verificare nei test.
 *
 * `d` è quanto Pix è nascosto dietro la barra, in larghezze del corpo:
 * 0 = fuori (solo il bordo destro dietro la barra), 1 = nascosto del tutto.
 */
export const PEEK_DURATION_S = 5

/** Dimensione del piccolo Pix rispetto a quello normale. */
export const PEEK_SCALE = 0.62

/** Perno della sbirciata nel tracciato del corpo: bordo destro, a metà altezza. */
export const PEEK_PIVOT = { x: 81, y: 193 } as const
const BODY_WIDTH = 60
/** Bordo destro della finestra (dietro la barra). */
const EDGE_X = 96

export interface PeekFrame {
  /** Quanto è nascosto (0 fuori, 1 nascosto). */
  d: number
  rot: number
  sx: number
  sy: number
  bob: number
  eyeX: number
  eyeY: number
  /** Apertura degli occhi (1 aperti, ~0.1 chiusi). */
  eyeOpen: number
  /** Ampiezza del "collo" che lo unisce alla barra (0–1). */
  neck: number
  /**
   * Quanta barra Pix ha preso per uscire (0–1): la barra si assottiglia dove
   * sbuca e si accorcia un poco. Negativo = si gonfia mentre il fluido rientra.
   */
  consumed: number
}

const HIDDEN = 1.08
const ONE_EYE = 0.38
const OUT = 0.06

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const easeOutBack = (x: number) => {
  const c = 1.9
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
}
const easeInBack = (x: number) => {
  const c = 0.6
  return (c + 1) * x ** 3 - c * x ** 2
}
const smooth = (x: number) => x * x * (3 - 2 * x)
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Posizione nel tempo, senza deformazioni. */
function hideAt(t: number): number {
  if (t < 1) return lerp(HIDDEN, ONE_EYE, easeOutBack(smooth(seg(t, 0, 1))))
  if (t < 1.6) return ONE_EYE
  if (t < 2.15) return lerp(ONE_EYE, OUT, easeOutBack(seg(t, 1.6, 2.15)))
  if (t < 4.2) return OUT
  return lerp(OUT, HIDDEN, easeInBack(seg(t, 4.2, 4.75)))
}

/** Picco "a campana" fra a e b (0 ai bordi, 1 al centro). */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * seg(t, a, b)))

export function peekFrame(t: number): PeekFrame {
  const d = hideAt(t)
  // Allungamento proporzionale alla velocità, a volume costante: è un fluido.
  const dt = 1 / 120
  const v = Math.abs(hideAt(t + dt) - hideAt(t - dt)) / (2 * dt)
  const stretch = Math.min(0.32, v * 0.11)
  // Prima di rientrare si raccoglie (anticipo) e appena uscito ondeggia.
  const squash = 0.12 * bump(t, 3.95, 4.3)
  const jiggle = 0.05 * Math.sin((t - 2.15) * 14) * Math.exp(-(t - 2.15) * 4) * (t > 2.15 && t < 3.2 ? 1 : 0)
  const sx = 1 + stretch + squash + jiggle
  const sy = 1 / sx

  // Si sporge inclinandosi verso l'esterno, poi si raddrizza per rientrare.
  const lean = smooth(seg(t, 1.6, 2.1)) * (1 - smooth(seg(t, 3.9, 4.3)))
  const rot = -11 * lean - 4 * bump(t, 0.35, 1.3) + 2.5 * Math.sin(t * 2.4) * lean
  const bob = -1.2 * Math.sin(t * 3.1) * lean

  // Sguardo: con un occhio guarda a sinistra, poi si guarda intorno.
  let eyeX = 0
  let eyeY = 0
  eyeX -= 3 * bump(t, 0.6, 1.65)
  eyeX -= 3 * bump(t, 2.2, 3.0)
  eyeY += 1.5 * bump(t, 2.2, 3.0)
  eyeX += 1.5 * bump(t, 3.0, 3.7)
  eyeY -= 1.2 * bump(t, 3.0, 3.7)

  // Doppio battito di palpebre mentre è fuori.
  const blink = Math.max(bump(t, 3.2, 3.36), bump(t, 3.48, 3.64))
  const eyeOpen = 1 - 0.88 * blink

  const neck = clamp01((HIDDEN - d) / 0.35)
  // La barra cede fluido mentre Pix esce e lo riprende quando rientra,
  // con un piccolo rigonfiamento finale prima di tornare com'era.
  const consumed = clamp01((HIDDEN - d) / (HIDDEN - OUT)) - 0.35 * bump(t, 4.62, 5)
  return { d, rot, sx, sy, bob, eyeX, eyeY, eyeOpen, neck, consumed }
}

/** Trasformazione SVG del corpo (tracciato `pixPath(1, …)`) per un fotogramma. */
export function peekTransform(f: PeekFrame, y: number, scale: number): string {
  const s = PEEK_SCALE * scale
  const px = EDGE_X + f.d * BODY_WIDTH * s
  return `translate(${r(px)} ${r(y + f.bob)}) rotate(${r(f.rot)}) scale(${r(s * f.sx)} ${r(s * f.sy)}) translate(${-PEEK_PIVOT.x} ${-PEEK_PIVOT.y})`
}

/** Trasformazione degli occhi (coordinate delle bozze, centro occhi 50,52). */
export function peekEyesTransform(f: PeekFrame): string {
  return `translate(${r(f.eyeX)} ${r(f.eyeY)}) translate(50 52) scale(1 ${r(f.eyeOpen)}) translate(-50 -52)`
}

/** Barra a riposo (coordinate dell'SVG): x 88–96, y 50–230, estremità arrotondate. */
const BAR = { left: 88, right: 96, top: 50, bottom: 230 } as const
/** Assottigliamento massimo (px su 8 di larghezza) e accorciamento di ogni estremità. */
const DENT_DEPTH = 4.6
const DENT_SPREAD = 15
const SHRINK = 5

/**
 * Tracciato della barra a cui Pix ha "preso" un po' di fluido all'altezza `y`:
 * il bordo sinistro rientra con un incavo morbido e la barra si accorcia un poco.
 */
export function consumedBarPath(consumed: number, y: number): string {
  const top = BAR.top + SHRINK * consumed
  const bottom = BAR.bottom - SHRINK * consumed
  const rad = (BAR.right - BAR.left) / 2
  const mid = BAR.left + rad
  const leftAt = (yy: number) => BAR.left + DENT_DEPTH * consumed * Math.exp(-(((yy - y) / DENT_SPREAD) ** 2))
  const k = rad * 0.5523
  const parts = [
    `M${r(mid)} ${r(top)}`,
    `C${r(mid + k)} ${r(top)} ${BAR.right} ${r(top + rad - k)} ${BAR.right} ${r(top + rad)}`,
    `L${BAR.right} ${r(bottom - rad)}`,
    `C${BAR.right} ${r(bottom - rad + k)} ${r(mid + k)} ${r(bottom)} ${r(mid)} ${r(bottom)}`,
    `C${r(mid - k)} ${r(bottom)} ${r(leftAt(bottom - rad))} ${r(bottom - rad + k)} ${r(leftAt(bottom - rad))} ${r(bottom - rad)}`
  ]
  // Bordo sinistro dal basso verso l'alto, fitto vicino all'incavo.
  for (let yy = bottom - rad - 2; yy > top + rad; yy -= Math.abs(yy - y) < DENT_SPREAD * 2.5 ? 1.5 : 12) {
    parts.push(`L${r(leftAt(yy))} ${r(yy)}`)
  }
  parts.push(`L${r(leftAt(top + rad))} ${r(top + rad)}`)
  parts.push(`C${r(leftAt(top + rad))} ${r(top + rad - k)} ${r(mid - k)} ${r(top)} ${r(mid)} ${r(top)} Z`)
  return parts.join(' ')
}

const r = (n: number) => Math.round(n * 1000) / 1000
