import { svgPathProperties } from 'svg-path-properties'
import type { PixShape, PixTransform } from '@shared/mascot'
import { pixPath } from './geometry'

/**
 * Animazioni del fluido: il contorno di Pix diventa un poligono di N punti e
 * ogni animazione sposta quei punti nel tempo (onde, tentacoli, battito…).
 * Ogni punto corrisponde sempre allo stesso punto della forma di partenza,
 * quindi il corpo resta un unico fluido che si deforma e torna com'era.
 */

export type Pt = [number, number]

export const SAMPLES = 480

/** Campiona un tracciato in N punti equidistanti lungo il contorno. */
export function samplePath(d: string, n = SAMPLES): Pt[] {
  const props = new svgPathProperties(d)
  const len = props.getTotalLength()
  return Array.from({ length: n }, (_, i) => {
    const p = props.getPointAtLength((len * i) / n)
    return [p.x, p.y] as Pt
  })
}

export function toPath(points: Pt[]): string {
  if (points.length === 0) return ''
  const r = (v: number) => Math.round(v * 100) / 100
  return `M${points.map(([x, y]) => `${r(x)} ${r(y)}`).join(' L')} Z`
}

/** Interpolazione punto per punto; t fuori da [0, 1] dà l'effetto gelatina. */
export function lerpPoints(a: Pt[], b: Pt[], t: number): Pt[] {
  return a.map(([x, y], i) => {
    const [bx, by] = b[i] ?? [x, y]
    return [x + (bx - x) * t, y + (by - y) * t]
  })
}

const gauss = (d: number, s: number) => Math.exp(-((d / s) ** 2))
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Allinea un poligono a un altro (stesso verso e punto di partenza più vicino). */
export function alignTo(base: Pt[], target: Pt[]): Pt[] {
  const n = base.length
  const cost = (pts: Pt[], k: number) => {
    let s = 0
    for (let i = 0; i < n; i += 4) {
      const [bx, by] = base[i]!
      const [tx, ty] = pts[(i + k) % n]!
      s += (bx - tx) ** 2 + (by - ty) ** 2
    }
    return s
  }
  let best = { pts: target, k: 0, c: Infinity }
  for (const pts of [target, [...target].reverse()]) {
    for (let k = 0; k < n; k++) {
      const c = cost(pts, k)
      if (c < best.c) best = { pts, k, c }
    }
  }
  return Array.from({ length: n }, (_, i) => best.pts[(i + best.k) % n]!)
}

/**
 * Dati precalcolati del contorno a riposo: per ogni punto la normale uscente,
 * la posizione orizzontale (u), quanto guarda in alto/in basso e l'angolo.
 */
export interface Body {
  pts: Pt[]
  cx: number
  cy: number
  w: number
  h: number
  nx: number[]
  ny: number[]
  u: number[]
  top: number[]
  low: number[]
  theta: number[]
  /** Forme d'arrivo già allineate punto per punto al contorno. */
  heart: Pt[]
  shield: Pt[]
  bubble: Pt[]
  /** Cestino (senza coperchio: il coperchio è un pezzo a parte che si apre). */
  trash: Pt[]
}

function prepare(pts: Pt[]): Body {
  const n = pts.length
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const w = maxX - minX
  const h = maxY - minY
  let nx: number[] = []
  let ny: number[] = []
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[(i - 2 + n) % n]!
    const [bx, by] = pts[(i + 2) % n]!
    const len = Math.hypot(bx - ax, by - ay) || 1
    nx.push((by - ay) / len)
    ny.push(-(bx - ax) / len)
  }
  // Le normali devono puntare fuori dal corpo.
  const out = pts.reduce((s, [x, y], i) => s + nx[i]! * (x - cx) + ny[i]! * (y - cy), 0)
  if (out < 0) {
    nx = nx.map((v) => -v)
    ny = ny.map((v) => -v)
  }
  return {
    pts,
    cx,
    cy,
    w,
    h,
    nx,
    ny,
    u: pts.map(([x]) => (x - cx) / (w / 2)),
    top: ny.map((v) => Math.max(0, -v) ** 3),
    low: ny.map((v) => Math.max(0, v) ** 3),
    theta: pts.map(([x, y]) => Math.atan2(y - cy, x - cx)),
    heart: alignTo(pts, samplePath(heartPath(cx, maxY, w), n)),
    shield: alignTo(pts, samplePath(scaledPath(SHIELD, cx, maxY, w), n)),
    bubble: alignTo(pts, samplePath(scaledPath(BUBBLE, cx, maxY, w), n)),
    trash: alignTo(pts, samplePath(scaledPath(TRASH, cx, maxY, w), n))
  }
}

/** Scudo (cassaforte) e fumetto (chat), disegnati su un corpo largo 66 con base a y = 226. */
const SHIELD =
  'M51 160 C62 160 74 163 84 168 L84 190 C84 208 71 220 51 228 C31 220 18 208 18 190 L18 168 C28 163 40 160 51 160 Z'
const BUBBLE =
  'M30 162 L72 162 C80 162 84 166 84 174 L84 200 C84 208 80 212 72 212 L46 212 L31 227 L34 212 L30 212 C22 212 18 208 18 200 L18 174 C18 166 22 162 30 162 Z'

/** Cestino: vaschetta a tronco di cono con il bordo, stessa base del corpo. */
const TRASH =
  'M24 171 L78 171 C80 171 81 172.5 80.8 174.5 L76 222 C75.6 224.4 74 226 71.5 226 L30.5 226 C28 226 26.4 224.4 26 222 L21.2 174.5 C21 172.5 22 171 24 171 Z'

/** Riporta un tracciato disegnato in quel riferimento alla misura del corpo attuale. */
function scaledPath(d: string, cx: number, bottom: number, w: number): string {
  const s = w / 66
  return d.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_m, x: string, y: string) => `${cx + (Number(x) - 51) * s} ${bottom + (Number(y) - 226) * s}`)
}

/** Cuore della stessa misura del corpo, appoggiato alla stessa base. */
function heartPath(cx: number, bottom: number, w: number): string {
  const s = w / 66
  const x = (v: number) => cx + (v - 51) * s
  const y = (v: number) => bottom + (v - 226) * s
  return (
    `M${x(51)} ${y(226)} C${x(30)} ${y(210)} ${x(17)} ${y(196)} ${x(17)} ${y(181)} ` +
    `C${x(17)} ${y(168)} ${x(27)} ${y(160)} ${x(37)} ${y(160)} C${x(44)} ${y(160)} ${x(49)} ${y(164)} ${x(51)} ${y(170)} ` +
    `C${x(53)} ${y(164)} ${x(58)} ${y(160)} ${x(65)} ${y(160)} C${x(75)} ${y(160)} ${x(85)} ${y(168)} ${x(85)} ${y(181)} ` +
    `C${x(85)} ${y(196)} ${x(72)} ${y(210)} ${x(51)} ${y(226)} Z`
  )
}

const cache = new Map<string, Body>()

/** Contorno a riposo di Pix (calcolato una volta per forma e dimensione). */
export function restBody(scale: number, shape: PixShape): Body {
  const key = `${scale}:${shape}`
  let b = cache.get(key)
  if (!b) {
    b = prepare(samplePath(pixPath(scale, shape)))
    cache.set(key, b)
  }
  return b
}

/** Battito "tu-tum" ogni 0,9 s. */
function beat(t: number): number {
  const ph = (t % 0.9) / 0.9
  return Math.max(0, Math.sin(Math.PI * clamp01(ph / 0.18))) + 0.6 * Math.max(0, Math.sin(Math.PI * clamp01((ph - 0.22) / 0.18)))
}

/**
 * Forma del corpo durante un'animazione: `t` sono i secondi dall'inizio,
 * `a` l'ampiezza (0 = forma a riposo, 1 = animazione piena; oltre 1 = rimbalzo).
 */
export function liveShape(b: Body, kind: PixTransform, t: number, a: number): Pt[] {
  if (kind === 'shield') {
    // Lo scudo "respira" piano e luccica con un leggero ondeggiare.
    const k = 1 + 0.035 * Math.sin(2.4 * t) * Math.min(1, Math.max(0, a))
    return b.pts.map(([x, y], i) => {
      const [sx, sy] = b.shield[i]!
      const mx = x + (sx - x) * a
      const my = y + (sy - y) * a
      return [b.cx + (mx - b.cx) * k, b.cy + (my - b.cy) * k] as Pt
    })
  }
  if (kind === 'bubble') {
    // Il fumetto "parla": piccoli sussulti verticali come sillabe, la punta che si muove.
    const talk = 1 + 0.045 * Math.abs(Math.sin(7 * t)) * Math.min(1, Math.max(0, a))
    return b.pts.map(([x, y], i) => {
      const [sx, sy] = b.bubble[i]!
      const mx = x + (sx - x) * a
      const my = y + (sy - y) * a
      const tail = Math.max(0, (my - b.cy) / (b.h / 2) - 0.75) * 4 * Math.sin(3 * t) * a
      return [mx + tail, b.cy + 0.25 * b.h + (my - b.cy - 0.25 * b.h) * talk] as Pt
    })
  }
  if (kind === 'heart') {
    const pulse = 1 + 0.1 * beat(t) * clamp01(a)
    return b.pts.map(([x, y], i) => {
      const [hx, hy] = b.heart[i]!
      const mx = x + (hx - x) * a
      const my = y + (hy - y) * a
      return [b.cx + (mx - b.cx) * pulse, b.cy + 0.15 * b.h + (my - b.cy - 0.15 * b.h) * pulse] as Pt
    })
  }

  return b.pts.map(([x, y], i) => {
    const nx = b.nx[i]!
    const ny = b.ny[i]!
    const u = b.u[i]!
    const top = b.top[i]!
    const low = b.low[i]!
    const th = b.theta[i]!
    let dx = 0
    let dy = 0
    switch (kind) {
      case 'wobble': {
        // Budino: onde che girano attorno al corpo.
        const r = (0.042 * Math.sin(3 * th - 6 * t) + 0.024 * Math.sin(5 * th + 4.3 * t)) * b.h * a
        dx += nx * r
        dy += ny * r
        break
      }
      case 'waves': {
        // Onda: increspature che scorrono sulla superficie in cima.
        dy -= top * 0.13 * b.h * a * (0.55 + 0.45 * Math.sin(3 * Math.PI * u - 7 * t))
        dx += top * 0.03 * b.w * a * Math.sin(2 * Math.PI * u - 5 * t)
        break
      }
      case 'tentacles':
        // Medusa: quattro tentacoli dal fondo, ognuno con il suo ritmo.
        ;[-0.62, -0.2, 0.22, 0.62].forEach((u0, k) => {
          const g = low * gauss(u - u0, 0.145)
          const reach = 0.28 + 0.06 * Math.sin(3 * t + k)
          dy += reach * b.h * g * a
          dx += 0.12 * b.w * g * g * a * Math.sin(4.5 * t + k * 1.4)
        })
        break
      case 'hourglass': {
        // Clessidra: il corpo si stringe in vita e pulsa, la sabbia "scende".
        // Strozzatura sotto gli occhi, così il viso resta libero.
        const v = (y - b.cy) / (b.h / 2) - 0.3
        const pinch = Math.exp(-((v / 0.32) ** 2)) * (0.85 + 0.15 * Math.sin(3 * t))
        dx -= Math.sign(x - b.cx) * Math.abs(nx) * 0.22 * b.w * pinch * a
        dy += 0.03 * b.h * Math.sin(2 * t) * top * a
        break
      }
      case 'melt':
        // Le gocce si allungano piano, ognuna con la sua velocità.
        ;[
          [-0.45, 0.26, 0.9],
          [0.08, 0.36, 0.6],
          [0.55, 0.2, 1.2]
        ].forEach(([u0, len, speed]) => {
          const grow = clamp01(t * speed!) * (0.85 + 0.15 * Math.sin(2.5 * t + u0! * 5))
          dy += len! * b.h * low * gauss(u - u0!, 0.11) * grow * a
        })
        dx += nx * 0.05 * b.w * Math.max(0, ny) * a
        dy += 0.04 * b.h * top * a
        break
    }
    return [x + dx, y + dy] as Pt
  })
}

// ======================= Inghiottire =======================

/** Tempi dell'inghiottire: il boccone entra in bocca a `bite`, tutto finisce a `total`. */
export const SWALLOW_S = { bite: 0.52, chewEnd: 2.15, total: 2.45 } as const

const sseg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const ssmooth = (x: number) => x * x * (3 - 2 * x)
const sbump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * sseg(t, a, b)))

/**
 * Pix inghiotte un boccone: prima aspira (si allunga verso l'alto), poi la
 * bocca si chiude e il corpo si schiaccia di colpo, il boccone scende come un
 * rigonfiamento lungo i fianchi, la pancia si gonfia, mastica e si assesta.
 */
export function swallowShape(b: Body, t: number): Pt[] {
  const bottom = b.cy + b.h / 2
  const inhale = ssmooth(sseg(t, 0, 0.45)) * (1 - sseg(t, 0.45, SWALLOW_S.bite + 0.04))
  const gulp = sbump(t, SWALLOW_S.bite - 0.02, SWALLOW_S.bite + 0.26)
  // Il boccone scende da sotto la bocca fino in fondo.
  const lumpY = b.cy - 0.02 * b.h + 0.4 * b.h * ssmooth(sseg(t, 0.62, 1.45))
  const lumpAmp = 0.11 * b.w * sbump(t, 0.6, 1.62)
  const belly = 0.06 * b.w * sbump(t, 1.2, 2.25)
  const chew = t > 1.5 && t < SWALLOW_S.chewEnd ? Math.abs(Math.sin((Math.PI * (t - 1.5)) / 0.32)) : 0
  const settleT = t - SWALLOW_S.chewEnd
  const settle = settleT > 0 ? 0.03 * Math.sin(settleT * 22) * Math.exp(-settleT * 7) : 0
  const sy = 1 + 0.08 * inhale - 0.13 * gulp - 0.045 * chew + settle
  const sx = 1 - 0.035 * inhale + 0.11 * gulp + 0.035 * chew - settle * 0.6
  return b.pts.map(([x, y], i) => {
    const nx = b.nx[i]!
    const ny = b.ny[i]!
    let px = b.cx + (x - b.cx) * sx
    let py = bottom + (y - bottom) * sy
    const g = Math.exp(-(((y - lumpY) / (0.15 * b.h)) ** 2)) * Math.abs(nx)
    px += nx * lumpAmp * g
    py += ny * lumpAmp * g * 0.3
    px += nx * belly * b.low[i]!
    py += ny * belly * b.low[i]!
    return [px, py] as Pt
  })
}

// ======================= Meteo e movimento come un liquido =======================

/** Durate: brividi (freddo) e pozza (caldo). */
export const SHIVER_S = 3.2
/** Durata del caldo (si affloscia, ansima, si riprende). */
export const HEAT_S = 4.2

/**
 * Brividi da liquido: la superficie vibra a piccole onde fitte che corrono
 * attorno al corpo, che intanto si stringe un po' su sé stesso.
 */
export function shiverShape(b: Body, t: number): Pt[] {
  const env = Math.sin(Math.PI * Math.min(1, Math.max(0, t / SHIVER_S))) ** 0.6
  const bottom = b.cy + b.h / 2
  const hug = 1 - 0.035 * env
  return b.pts.map(([x, y], i) => {
    const th = b.theta[i]!
    const r = env * b.h * (0.009 * Math.sin(12 * th + 55 * t) + 0.006 * Math.sin(7 * th - 38 * t))
    return [b.cx + (x - b.cx) * hug + b.nx[i]! * r, bottom + (y - bottom) * (1 + 0.02 * env) + b.ny[i]! * r] as Pt
  })
}

/**
 * Caldo: Pix si ammorbidisce e si affloscia come una gelatina al sole (la cima
 * cede e ondeggia piano, i fianchi si allargano) e intanto ansima; poi si riprende.
 */
export function heatShape(b: Body, t: number): Pt[] {
  const env = ssmooth(sseg(t, 0, 0.9)) * (1 - ssmooth(sseg(t, HEAT_S - 0.9, HEAT_S)))
  const bottom = b.cy + b.h / 2
  const pant = Math.sin(t * Math.PI * 2 * 2.6) * 0.5 + 0.5
  // Cede: più basso e più largo (la base resta sul pavimento); la parte alta dondola piano.
  const sy = 1 - env * (0.17 + 0.02 * pant)
  const sx = 1 + env * (0.13 + 0.01 * pant)
  return b.pts.map(([x, y]) => {
    const up = Math.max(0, (bottom - y) / b.h)
    const sway = up * up * env * 0.1 * b.w * Math.sin(t * 1.6)
    return [b.cx + (x - b.cx) * sx * (1 + 0.06 * env * (1 - up)) + sway, bottom + (y - bottom) * sy] as Pt
  })
}

/**
 * Liquido nel bicchiere: mentre scorri, la superficie si inclina (un lato
 * sale, l'altro scende) e la parte alta resta un po' indietro; poi ondeggia.
 * `a` va da -1 a 1.
 */
export function sloshShape(b: Body, a: number, t: number): Pt[] {
  return b.pts.map(([x, y], i) => {
    const top = b.top[i]!
    const u = b.u[i]!
    const wave = 0.015 * b.h * Math.abs(a) * Math.sin(2 * Math.PI * u - t * 8)
    return [x + top * a * 0.06 * b.w, y + top * (-a * u * 0.2 * b.h + wave)] as Pt
  })
}

/** Cestino: si trasforma (0–0.32 s), il coperchio si apre e la cosa eliminata ci cade dentro, poi torna Pix. */
export const TRASH_S = { formed: 0.32, slam: 1.05, back: 1.45, total: 2.05 } as const

export function trashShape(b: Body, t: number): Pt[] {
  let k: number
  if (t < TRASH_S.formed) {
    const x = sseg(t, 0, TRASH_S.formed)
    const c = 1.8
    k = 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
  } else if (t < TRASH_S.back) k = 1
  else {
    const x = sseg(t, TRASH_S.back, TRASH_S.total)
    const c = 1.6
    k = 1 - (1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2)
  }
  // Il coperchio sbatte: il cestino si schiaccia e rimbalza.
  const slam = sbump(t, TRASH_S.slam - 0.02, TRASH_S.slam + 0.22)
  const bottom = b.cy + b.h / 2
  return b.pts.map(([x, y], i) => {
    const [tx, ty] = b.trash[i]!
    const mx = x + (tx - x) * k
    const my = y + (ty - y) * k
    return [b.cx + (mx - b.cx) * (1 + 0.06 * slam), bottom + (my - bottom) * (1 - 0.08 * slam)] as Pt
  })
}
