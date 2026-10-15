import type { PixShape } from '@shared/mascot'

/**
 * Sbirciata a pannello chiuso. Pix e la barra sono un unico fluido: la barra
 * si gonfia in un punto, la goccia cresce e diventa la testa di Pix, che resta
 * sempre attaccata alla barra con un collo che si allunga e si assottiglia.
 * Poi la goccia viene riassorbita. Tutto è un solo tracciato (la barra stessa),
 * calcolato da funzioni pure così i fotogrammi si possono verificare nei test.
 */
export const PEEK_DURATION_S = 5.2

/** Dimensione della testa rispetto a Pix normale. */
export const PEEK_SCALE = 0.62

/** Barra a riposo (coordinate dell'SVG): x 88–96, y 50–230, estremità arrotondate. */
const BAR = { left: 88, right: 96, top: 50, bottom: 230 } as const
/** Accorciamento di ogni estremità della barra quando la testa è formata. */
const SHRINK = 5
/** Distanza massima fra barra e testa (lunghezza del collo). */
const GAP_OUT = 8.5

export interface PeekFrame {
  /** Crescita della goccia (0 = barra liscia, 1 = testa formata). */
  grow: number
  /** Lunghezza del collo in px. */
  gap: number
  /** Allungamento orizzontale della testa (a volume costante). */
  stretch: number
  rot: number
  bob: number
  eyeX: number
  eyeY: number
  /** Apertura degli occhi (1 aperti, ~0.1 chiusi). */
  eyeOpen: number
  /** Visibilità del viso (gli occhi compaiono quando la testa è formata). */
  face: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const smooth = (x: number) => x * x * (3 - 2 * x)
const easeOutBack = (x: number) => {
  const c = 1.15
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
}
/** Picco "a campana" fra a e b (0 ai bordi, 1 al centro). */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * seg(t, a, b)))

function growAt(t: number): number {
  if (t < 1.3) return easeOutBack(seg(t, 0, 1.3))
  if (t < 4.0) return 1
  return 1 - smooth(seg(t, 4.0, 4.9))
}

function gapAt(t: number): number {
  const out = t < 3.85 ? easeOutBack(seg(t, 0.5, 1.8)) : 1 - smooth(seg(t, 3.85, 4.6))
  return 0.6 + (GAP_OUT - 0.6) * out
}

export function peekFrame(t: number): PeekFrame {
  const grow = growAt(t)
  const gap = gapAt(t)
  // Si allunga quando il collo si muove, poi tremola come una gelatina.
  const dt = 1 / 120
  const v = (gapAt(t + dt) - gapAt(t - dt)) / (2 * dt)
  const jiggle = 0.06 * Math.sin((t - 1.3) * 13) * Math.exp(-(t - 1.3) * 3.5) * (t > 1.3 && t < 2.6 ? 1 : 0)
  const stretch = Math.min(0.15, Math.abs(v) * 0.012) + jiggle

  const out = smooth(seg(t, 1.0, 1.8)) * (1 - smooth(seg(t, 3.8, 4.3)))
  const rot = -8 * out + 3 * Math.sin(t * 2.3) * out
  const bob = -1.5 * Math.sin(t * 2.9) * out

  let eyeX = 0
  let eyeY = 0
  eyeX -= 3 * bump(t, 1.4, 2.4)
  eyeY += 1 * bump(t, 1.4, 2.4)
  eyeX += 1.8 * bump(t, 2.5, 3.2)
  eyeY -= 1.4 * bump(t, 2.5, 3.2)
  const blink = Math.max(bump(t, 3.3, 3.46), bump(t, 3.56, 3.72))
  const eyeOpen = 1 - 0.88 * blink
  const face = smooth(seg(grow, 0.6, 0.9)) * (1 - smooth(seg(t, 3.95, 4.35)))
  return { grow, gap, stretch, rot, bob, eyeX, eyeY, eyeOpen, face }
}

/** Esponente del superellisse della testa, secondo la forma scelta per Pix. */
const SHAPE_POWER: Record<PixShape, number> = { squircle: 4, round: 2, tile: 6, egg: 2.4, soft: 3 }

interface Head {
  cx: number
  cy: number
  a: number
  b: number
  rot: number
  n: number
  /** Crescita limitata a 0–1. */
  grow01: number
}

export function headOf(f: PeekFrame, y: number, scale: number, shape: PixShape): Head {
  const s = PEEK_SCALE * scale
  const a = 30 * s * f.grow * (1 + f.stretch)
  const b = (33 * s * f.grow) / (1 + f.stretch)
  // Da piccola è una goccia tonda; crescendo prende la forma scelta per Pix.
  const n = 2 + (SHAPE_POWER[shape] - 2) * smooth(clamp01(f.grow))
  return { cx: BAR.left - f.gap - a, cy: y + f.bob, a, b, rot: f.rot, n, grow01: clamp01(f.grow) }
}

/** Punto della testa all'angolo `th` (y verso il basso: 0 destra, π/2 sotto). */
function headPoint(h: Head, th: number): [number, number] {
  const c = Math.cos(th)
  const s = Math.sin(th)
  const e = 2 / h.n
  const x = h.a * Math.sign(c) * Math.abs(c) ** e
  const y = h.b * Math.sign(s) * Math.abs(s) ** e
  const r = (h.rot * Math.PI) / 180
  return [h.cx + x * Math.cos(r) - y * Math.sin(r), h.cy + x * Math.sin(r) + y * Math.cos(r)]
}

function unit(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]) || 1
  return [v[0] / l, v[1] / l]
}

/**
 * Tracciato unico barra + collo + testa. Con `grow` = 0 è la barra a riposo.
 * Il collo parte tangente alla barra e arriva tangente alla testa: nessuno
 * spigolo, come una goccia di liquido che si stira.
 */
export function peekBodyPath(f: PeekFrame, y: number, scale: number, shape: PixShape): string {
  const top = BAR.top + SHRINK * f.grow
  const bottom = BAR.bottom - SHRINK * f.grow
  const rad = (BAR.right - BAR.left) / 2
  const mid = BAR.left + rad
  const k = rad * 0.5523
  const parts = [
    `M${r(mid)} ${r(top)}`,
    `C${r(mid + k)} ${r(top)} ${BAR.right} ${r(top + rad - k)} ${BAR.right} ${r(top + rad)}`,
    `L${BAR.right} ${r(bottom - rad)}`,
    `C${BAR.right} ${r(bottom - rad + k)} ${r(mid + k)} ${r(bottom)} ${r(mid)} ${r(bottom)}`,
    `C${r(mid - k)} ${r(bottom)} ${BAR.left} ${r(bottom - rad + k)} ${BAR.left} ${r(bottom - rad)}`
  ]

  if (f.grow > 0.01) {
    const h = headOf(f, y, scale, shape)
    // Più il collo è lungo, più si assottiglia e si attacca in un punto più stretto.
    const stretchK = clamp01(f.gap / GAP_OUT)
    const th0 = ((80 - 32 * stretchK) * Math.PI) / 180
    // Sulla barra l'attacco è più largo della testa: un menisco concavo, come un liquido.
    const junction = Math.max(3, h.b * (1 - 0.4 * stretchK) + (2 + 4 * h.grow01) * (1 - 0.3 * stretchK))
    const y1 = h.cy - junction
    const y2 = h.cy + junction
    // Il raccordo sulla barra non supera metà attacco, altrimenti il collo si strozza.
    const fillet = junction * 0.5

    const pb = headPoint(h, th0)
    const pt = headPoint(h, 2 * Math.PI - th0)
    const eps = 0.01
    const g = Math.max(2, (BAR.left - pb[0]) * 0.55)
    const tb = unit(sub(headPoint(h, th0 + eps), headPoint(h, th0 - eps)))
    const tt = unit(sub(headPoint(h, 2 * Math.PI - th0 + eps), headPoint(h, 2 * Math.PI - th0 - eps)))

    parts.push(`L${BAR.left} ${r(y2)}`)
    // Le maniglie verso la testa restano a sinistra della barra: niente punte.
    const cb: [number, number] = [Math.min(pb[0] - tb[0] * g, BAR.left - 1), pb[1] - tb[1] * g]
    const ct: [number, number] = [Math.min(pt[0] + tt[0] * g, BAR.left - 1), pt[1] + tt[1] * g]
    parts.push(`C${BAR.left} ${r(y2 - fillet)} ${r(cb[0])} ${r(cb[1])} ${r(pb[0])} ${r(pb[1])}`)
    const steps = 56
    for (let i = 1; i < steps; i++) {
      const p = headPoint(h, th0 + ((2 * Math.PI - 2 * th0) * i) / steps)
      parts.push(`L${r(p[0])} ${r(p[1])}`)
    }
    parts.push(`L${r(pt[0])} ${r(pt[1])}`)
    parts.push(`C${r(ct[0])} ${r(ct[1])} ${BAR.left} ${r(y1 + fillet)} ${BAR.left} ${r(y1)}`)
  }

  parts.push(`L${BAR.left} ${r(top + rad)}`)
  parts.push(`C${BAR.left} ${r(top + rad - k)} ${r(mid - k)} ${r(top)} ${r(mid)} ${r(top)} Z`)
  return parts.join(' ')
}

/** Trasformazione del viso (coordinate delle bozze 100×100, corpo x 20–80, y 22–88). */
export function peekFaceTransform(f: PeekFrame, y: number, scale: number, shape: PixShape): string {
  const h = headOf(f, y, scale, shape)
  return `translate(${r(h.cx)} ${r(h.cy)}) rotate(${r(h.rot)}) scale(${r(h.a / 30)} ${r(h.b / 33)}) translate(-50 -55)`
}

/** Trasformazione degli occhi (centro occhi 50,52). */
export function peekEyesTransform(f: PeekFrame): string {
  return `translate(${r(f.eyeX)} ${r(f.eyeY)}) translate(50 52) scale(1 ${r(f.eyeOpen)}) translate(-50 -52)`
}

const sub = (p: [number, number], q: [number, number]): [number, number] => [p[0] - q[0], p[1] - q[1]]
const r = (n: number) => Math.round(n * 100) / 100
