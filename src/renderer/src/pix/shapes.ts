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
  heart: Pt[]
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
    heart: alignTo(pts, samplePath(heartPath(cx, maxY, w), n))
  }
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
      case 'antennae':
        ;[-0.3, 0.3].forEach((u0, k) => {
          const g = top * gauss(u - u0, 0.09)
          dy -= (0.4 + 0.05 * Math.sin(8 * t + k)) * b.h * g * a
          dx += (Math.sign(u0) * 0.08 + 0.1 * Math.sin(5 * t + k * Math.PI * 0.7)) * b.w * g * g * a
        })
        break
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
