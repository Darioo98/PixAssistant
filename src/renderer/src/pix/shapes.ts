import { svgPathProperties } from 'svg-path-properties'
import type { PixAccessory, PixShape, PixTransform } from '@shared/mascot'
import { pixPath } from './geometry'

/**
 * Trasformazioni del fluido: il contorno di Pix diventa un poligono di N punti
 * e ogni trasformazione sposta quei punti con profili morbidi (gaussiani o
 * triangolari). Ogni punto corrisponde sempre allo stesso punto della forma
 * di partenza, quindi il passaggio è continuo: è il corpo stesso che si
 * allunga in corna, orecchie, gocce… e poi torna com'era.
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

/** Interpolazione punto per punto; t fuori da [0, 1] dà l'effetto gelatina (rimbalzo). */
export function lerpPoints(a: Pt[], b: Pt[], t: number): Pt[] {
  return a.map(([x, y], i) => {
    const [bx, by] = b[i] ?? [x, y]
    return [x + (bx - x) * t, y + (by - y) * t]
  })
}

interface Box {
  cx: number
  cy: number
  w: number
  h: number
}

function box(points: Pt[]): Box {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }
}

const gauss = (d: number, s: number) => Math.exp(-((d / s) ** 2))
const tri = (d: number, s: number) => Math.max(0, 1 - Math.abs(d) / s)
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

/** Cuore della stessa misura del corpo, appoggiato alla stessa base. */
function heart(b: Box, bottom: number): string {
  const s = b.w / 66
  const x = (v: number) => b.cx + (v - 51) * s
  const y = (v: number) => bottom + (v - 226) * s
  return (
    `M${x(51)} ${y(226)} C${x(30)} ${y(210)} ${x(17)} ${y(196)} ${x(17)} ${y(181)} ` +
    `C${x(17)} ${y(168)} ${x(27)} ${y(160)} ${x(37)} ${y(160)} C${x(44)} ${y(160)} ${x(49)} ${y(164)} ${x(51)} ${y(170)} ` +
    `C${x(53)} ${y(164)} ${x(58)} ${y(160)} ${x(65)} ${y(160)} C${x(75)} ${y(160)} ${x(85)} ${y(168)} ${x(85)} ${y(181)} ` +
    `C${x(85)} ${y(196)} ${x(72)} ${y(210)} ${x(51)} ${y(226)} Z`
  )
}

/** Normali uscenti (versori) di un poligono chiuso. */
function normals(points: Pt[], b: Box): Pt[] {
  const n = points.length
  const raw = points.map((_, i) => {
    const [ax, ay] = points[(i - 2 + n) % n]!
    const [bx, by] = points[(i + 2) % n]!
    const tx = bx - ax
    const ty = by - ay
    const len = Math.hypot(tx, ty) || 1
    return [ty / len, -tx / len] as Pt
  })
  // Verso: le normali devono puntare fuori dal corpo.
  const outward = raw.reduce((s, [nx, ny], i) => s + nx * (points[i]![0] - b.cx) + ny * (points[i]![1] - b.cy), 0)
  return outward >= 0 ? raw : raw.map(([nx, ny]) => [-nx, -ny] as Pt)
}

/**
 * Deforma il contorno di base nella trasformazione richiesta. Il peso di ogni
 * spostamento dipende da dove "guarda" il bordo: le corna crescono solo dai
 * punti rivolti verso l'alto, le gocce solo da quelli rivolti verso il basso,
 * così il resto del corpo non si deforma.
 */
export function deform(base: Pt[], kind: PixTransform): Pt[] {
  const b = box(base)
  const bottom = b.cy + b.h / 2
  if (kind === 'heart') return alignTo(base, samplePath(heart(b, bottom), base.length))
  const nrm = normals(base, b)

  return base.map(([x, y], i) => {
    const [nx, ny] = nrm[i]!
    const u = (x - b.cx) / (b.w / 2) // -1 sinistra … +1 destra
    const top = Math.max(0, -ny) ** 3 // 1 sul bordo superiore
    const low = Math.max(0, ny) ** 3 // 1 sul bordo inferiore
    let dx = 0
    let dy = 0
    switch (kind) {
      case 'horns':
        for (const u0 of [-0.5, 0.5]) {
          const k = top * gauss(u - u0, 0.16)
          dy -= 0.42 * b.h * k
          dx += Math.sign(u0) * 0.14 * b.w * k * k
        }
        break
      case 'ears':
        for (const u0 of [-0.52, 0.52]) {
          const k = top * tri(u - u0, 0.3)
          dy -= 0.3 * b.h * k
          dx += Math.sign(u0) * 0.04 * b.w * k
        }
        break
      case 'antennae':
        for (const u0 of [-0.3, 0.3]) {
          const k = top * gauss(u - u0, 0.09)
          dy -= 0.4 * b.h * k
          dx += Math.sign(u0) * 0.1 * b.w * k * k
        }
        break
      case 'tuft': {
        const k = top * gauss(u - 0.05, 0.14)
        dy -= 0.3 * b.h * k
        dx += 0.14 * b.w * k * k
        break
      }
      case 'melt':
        ;[
          [-0.45, 0.24],
          [0.08, 0.34],
          [0.55, 0.18]
        ].forEach(([u0, hgt]) => {
          dy += hgt! * b.h * low * gauss(u - u0!, 0.12)
        })
        dx += nx * 0.05 * b.w * Math.max(0, ny) // si allarga in basso
        dy += 0.04 * b.h * top // e si affloscia un po' in cima
        break
      case 'cloud': {
        const theta = Math.atan2(y - b.cy, x - b.cx)
        const k = (0.5 + 0.5 * Math.cos(7 * theta)) ** 1.5 * (1 - 0.8 * low)
        dx += nx * 0.09 * b.h * k
        dy += ny * 0.09 * b.h * k
        break
      }
      case 'spiky': {
        const theta = Math.atan2(y - b.cy, x - b.cx)
        const k = Math.max(0, Math.cos(9 * theta)) ** 4
        dx += nx * 0.16 * b.h * k
        dy += ny * 0.16 * b.h * k
        break
      }
    }
    return [x + dx, y + dy] as Pt
  })
}

const cache = new Map<string, Pt[]>()

/** Contorno (in punti) di Pix con eventuale trasformazione, calcolato una volta sola. */
export function shapePoints(scale: number, shape: PixShape, kind: PixTransform | PixAccessory | null): Pt[] {
  const key = `${scale}:${shape}:${kind ?? 'none'}`
  let pts = cache.get(key)
  if (!pts) {
    const base = kind && kind !== 'none' ? shapePoints(scale, shape, null) : samplePath(pixPath(scale, shape))
    pts = kind && kind !== 'none' ? deform(base, kind) : base
    cache.set(key, pts)
  }
  return pts
}
