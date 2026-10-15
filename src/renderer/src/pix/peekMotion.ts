import type { PixShape } from '@shared/mascot'

/**
 * Sbirciata a pannello chiuso. Pix e la barra sono un unico fluido: la barra
 * si gonfia in un punto, la goccia cresce e diventa la testa di Pix, che resta
 * sempre attaccata alla barra con un collo che si allunga e si assottiglia.
 * Poi la goccia viene riassorbita. Tutto è un solo tracciato (la barra stessa),
 * calcolato da funzioni pure così i fotogrammi si possono verificare nei test.
 */
/** Dimensione della testa rispetto a Pix normale. */
export const PEEK_SCALE = 0.62

/** Barra a riposo (coordinate dell'SVG): x 88–96, y 50–230, estremità arrotondate. */
export const BAR = { left: 88, right: 96, top: 50, bottom: 230 } as const
/** Accorciamento di ogni estremità della barra quando la testa è formata: Pix usa molta barra. */
const SHRINK = 26
/** Distanza massima fra barra e testa (lunghezza del collo). */
const GAP_OUT = 8.5
/** Momenti chiave: inizio della paura, risucchio, fine del risucchio. */
const T_WORRY = 2.95
const T_SUCK = 3.5
const T_IN = 3.68
export const PEEK_DURATION_S = 5
/** Da quando (s) il cursore che si avvicina in fretta può spaventarlo (la testa è già fuori). */
export const PEEK_SCARE_FROM_S = 0.55
/** Dopo questo momento rientra comunque da solo: lo spavento non serve più. */
export const PEEK_SCARE_UNTIL_S = T_SUCK

/** Spavento: sobbalzo, poi risucchio istantaneo e un'onda d'urto più forte. */
const SCARE_JOLT = 0.22
const SCARE_SUCK = 0.11
const SCARE_SHOCK_AMP = 1.7
export const SCARE_DURATION_S = SCARE_JOLT + SCARE_SUCK + 1.4

export interface PeekFrame {
  /** Crescita della goccia (0 = barra liscia, 1 = testa formata). */
  grow: number
  /** Lunghezza del collo in px. */
  gap: number
  /** Allungamento orizzontale della testa (a volume costante; negativo = in verticale). */
  stretch: number
  rot: number
  bob: number
  eyeX: number
  eyeY: number
  /** Apertura degli occhi (1 aperti, ~0.1 chiusi). */
  eyeOpen: number
  /** Occhi sgranati per lo spavento (1 normali). */
  eyeScale: number
  /** Goccia di sudore (0–1). */
  sweat: number
  /** Visibilità del viso (gli occhi compaiono quando la testa è formata). */
  face: number
  /** Sobbalzo di paura (0–1): occhi tondi e punto esclamativo. */
  startle: number
  /** Secondi dal risucchio (onda d'urto sulla barra); negativo prima. */
  shock: number
  /** Forza dell'onda d'urto (1 normale, di più quando si spaventa). */
  shockAmp: number
  /**
   * Quanta barra ha preso Pix (0–1). Resta presa finché la goccia non è
   * rientrata, poi la barra si riallunga di scatto (e rimbalza).
   */
  pull: number
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
/** Risucchio: parte piano e accelera di colpo. */
const suck = (t: number) => seg(t, T_SUCK, T_IN) ** 2.4

function growAt(t: number): number {
  if (t < 1.3) return easeOutBack(seg(t, 0, 1.3))
  // Preoccupato si rannicchia un po', poi viene risucchiato.
  const cower = 1 - 0.12 * smooth(seg(t, T_WORRY, T_SUCK))
  return cower * (1 - suck(t))
}

function pullAt(t: number): number {
  if (t < 1.3) return clamp01(easeOutBack(seg(t, 0, 1.3)))
  const cower = 1 - 0.12 * smooth(seg(t, T_WORRY, T_SUCK))
  if (t < T_IN) return cower
  return cower * (1 - seg(t, T_IN, T_IN + 0.12)) ** 2
}

function gapAt(t: number): number {
  const out = easeOutBack(seg(t, 0.5, 1.8)) * (1 - 0.35 * smooth(seg(t, T_WORRY, T_SUCK)))
  return 0.6 + (GAP_OUT - 0.6) * out * (1 - suck(t))
}

export function peekFrame(t: number): PeekFrame {
  const grow = growAt(t)
  const gap = gapAt(t)
  const worry = smooth(seg(t, T_WORRY, T_WORRY + 0.15)) * (t < T_IN ? 1 : 0)
  // Si allunga quando il collo si muove, poi tremola come una gelatina; risucchiato si stira verso la barra.
  const dt = 1 / 120
  const v = (gapAt(t + dt) - gapAt(t - dt)) / (2 * dt)
  const jiggle = 0.06 * Math.sin((t - 1.3) * 13) * Math.exp(-(t - 1.3) * 3.5) * (t > 1.3 && t < 2.6 ? 1 : 0)
  const tremble = 0.035 * Math.sin(t * 70) * worry
  const stretch = Math.min(0.15, Math.abs(v) * 0.012) + jiggle + tremble + 0.45 * bump(t, T_SUCK, T_IN + 0.04)

  const out = smooth(seg(t, 1.0, 1.8)) * (1 - smooth(seg(t, T_WORRY, T_SUCK)))
  const rot = -8 * out + 3 * Math.sin(t * 2.3) * out + 2.5 * Math.sin(t * 57) * worry
  const bob = -1.5 * Math.sin(t * 2.9) * out

  // Sguardo: a sinistra, battito di palpebre, in alto a destra; poi la paura.
  let eyeX = 0
  let eyeY = 0
  eyeX -= 3 * bump(t, 1.4, 2.2)
  eyeY += 1 * bump(t, 1.4, 2.2)
  eyeX += 1.8 * bump(t, 2.5, 2.95)
  eyeY -= 1.4 * bump(t, 2.5, 2.95)
  // Occhi che saettano a destra e sinistra, preoccupati.
  eyeX += 2.6 * Math.sign(Math.sin((t - T_WORRY) * 16)) * worry * (t > T_WORRY + 0.1 ? 1 : 0)
  eyeY -= 0.8 * worry
  const blink = Math.max(bump(t, 2.24, 2.38), bump(t, 2.44, 2.58))
  const eyeOpen = 1 - 0.88 * blink
  const eyeScale = 1 + 0.32 * worry
  const sweat = worry * (1 - seg(t, T_SUCK, T_SUCK + 0.08))
  const face = smooth(seg(grow, 0.6, 0.9)) * (1 - seg(t, T_SUCK + 0.02, T_SUCK + 0.12))
  const shock = t - T_IN
  return { grow, gap, stretch, rot, bob, eyeX, eyeY, eyeOpen, eyeScale, sweat, face, startle: 0, shock, shockAmp: 1, pull: pullAt(t) }
}

/**
 * Spavento (il cursore gli corre incontro): parte dal fotogramma in cui si
 * trovava. Sobbalza all'indietro con gli occhi tondi e un "!", trema, poi
 * viene risucchiato all'istante e la barra fa un'onda d'urto più forte.
 */
export function scaredFrame(from: PeekFrame, tau: number): PeekFrame {
  const jolt = bump(tau, 0, SCARE_JOLT)
  if (tau < SCARE_JOLT) {
    return {
      ...from,
      grow: from.grow * (1 + 0.1 * jolt),
      gap: from.gap * (1 - 0.4 * seg(tau, 0, SCARE_JOLT)),
      stretch: -0.22 * jolt,
      rot: from.rot * (1 - seg(tau, 0, 0.08)) + 7 * Math.sin(tau * 70) * (1 - seg(tau, 0, SCARE_JOLT)),
      bob: from.bob - 4 * jolt,
      eyeX: 0,
      eyeY: -0.8 * jolt,
      eyeOpen: 1,
      eyeScale: 1,
      sweat: 1,
      face: 1,
      startle: smooth(seg(tau, 0, 0.05)),
      shock: -1,
      shockAmp: SCARE_SHOCK_AMP
    }
  }
  const k = seg(tau, SCARE_JOLT, SCARE_JOLT + SCARE_SUCK) ** 2
  const shock = tau - SCARE_JOLT - SCARE_SUCK
  return {
    ...from,
    grow: from.grow * (1 - k),
    gap: from.gap * 0.6 * (1 - k) + 0.6 * k,
    stretch: 0.6 * Math.sin(Math.PI * k),
    rot: 0,
    bob: from.bob * (1 - k),
    eyeX: 0,
    eyeY: 0,
    eyeOpen: 1,
    eyeScale: 1,
    sweat: 1 - k,
    face: clamp01(1 - k * 1.6),
    startle: 1 - k,
    shock,
    shockAmp: SCARE_SHOCK_AMP,
    pull: shock < 0 ? from.pull : from.pull * (1 - seg(shock, 0, 0.1)) ** 2
  }
}

/**
 * Spostamento verso sinistra del bordo della barra all'altezza `yy`:
 * l'onda d'urto parte dal punto del risucchio e corre in su e in giù smorzandosi.
 */
function shockAt(shock: number, amp: number, y: number, yy: number): number {
  if (shock < 0 || shock > 1.4) return 0
  const decay = Math.exp(-2.4 * shock)
  const front = 170 * shock
  const g = (d: number) => Math.exp(-((d / 7) ** 2))
  const pulse = 3.4 * decay * (g(yy - y - front) + g(yy - y + front))
  const recoil = 5 * Math.exp(-10 * shock) * g((yy - y) * 0.7)
  return amp * (pulse + recoil)
}

/** Le estremità tornano al loro posto rimbalzando dopo il risucchio. */
function endSpring(shock: number, amp: number): number {
  if (shock < 0) return 0
  return amp * 7 * Math.exp(-3.5 * shock) * Math.sin(10 * shock)
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

/** Tangente della testa nel verso di percorrenza (angoli crescenti). */
function tangent(h: Head, th: number): [number, number] {
  const eps = 0.01
  return unit(sub(headPoint(h, th + eps), headPoint(h, th - eps)))
}

/**
 * Tracciato unico barra + collo + testa. Con `grow` = 0 è la barra a riposo.
 * Il collo parte tangente alla barra e arriva tangente alla testa: nessuno
 * spigolo, come una goccia di liquido che si stira.
 */
export function peekBodyPath(f: PeekFrame, y: number, scale: number, shape: PixShape): string {
  const used = SHRINK * f.pull - endSpring(f.shock, f.shockAmp)
  const top = BAR.top + used
  const bottom = BAR.bottom - used
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
    const g = Math.max(2, (BAR.left - pb[0]) * 0.55)
    const tb = tangent(h, th0)
    const tt = tangent(h, 2 * Math.PI - th0)

    parts.push(`L${BAR.left} ${r(y2)}`)
    // Le maniglie verso la testa restano a sinistra della barra: niente punte.
    const cb: [number, number] = [Math.min(pb[0] - tb[0] * g, BAR.left - 1), pb[1] - tb[1] * g]
    const ct: [number, number] = [Math.min(pt[0] + tt[0] * g, BAR.left - 1), pt[1] + tt[1] * g]
    parts.push(`C${BAR.left} ${r(y2 - fillet)} ${r(cb[0])} ${r(cb[1])} ${r(pb[0])} ${r(pb[1])}`)
    const steps = 56
    for (let i = 1; i <= steps; i++) {
      const p = headPoint(h, th0 + ((2 * Math.PI - 2 * th0) * i) / steps)
      parts.push(`L${r(p[0])} ${r(p[1])}`)
    }
    parts.push(`C${r(ct[0])} ${r(ct[1])} ${BAR.left} ${r(y1 + fillet)} ${BAR.left} ${r(y1)}`)
  }

  if (f.shock >= 0 && f.shock <= 1.4) {
    // Onda d'urto: il bordo sinistro ondeggia dal basso verso l'alto.
    for (let yy = bottom - rad - 1.5; yy > top + rad; yy -= 1.5) parts.push(`L${r(BAR.left - shockAt(f.shock, f.shockAmp, y, yy))} ${r(yy)}`)
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
  return `translate(${r(f.eyeX)} ${r(f.eyeY)}) translate(50 52) scale(${r(f.eyeScale)} ${r(f.eyeOpen * f.eyeScale)}) translate(-50 -52)`
}

const sub = (p: [number, number], q: [number, number]): [number, number] => [p[0] - q[0], p[1] - q[1]]
const r = (n: number) => Math.round(n * 100) / 100
