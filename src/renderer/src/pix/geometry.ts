import { interpolate, type Interpolator } from 'flubber'
import type { PixShape } from '@shared/mascot'

/**
 * Forme chiave del morph barra → rigonfiamento → goccia → squircle, prese dalla
 * demo approvata (pix-morph-demo.html) e spostate nel sistema di coordinate
 * dell'SVG della mascotte: viewBox 0 0 96 240, ancorato in basso a destra.
 * La barra occupa x 88–96, y 50–230; Pix (dimensione media) x 21–81, y 160–226.
 */
export const VIEW = { width: 96, height: 240 } as const

/** Spostamento dalla demo (680×260) all'SVG della mascotte. */
const DX = -579
const DY = -10

const DEMO = {
  bar: 'M671 60 C673 60 675 62 675 64 L675 236 C675 238 673 240 671 240 C669 240 667 238 667 236 L667 64 C667 62 669 60 671 60 Z',
  blob: 'M672 96 C676 124 677 144 677 166 L677 238 C662 248 612 248 604 216 C597 188 628 178 648 164 C663 152 668 126 672 96 Z',
  drop: 'M668 150 C672 166 668 178 662 186 C654 196 668 202 660 228 C652 248 604 246 598 214 C594 188 616 176 634 170 C650 164 662 160 668 150 Z',
  pix: 'M630 170 C652 170 660 178 660 200 L660 206 C660 228 652 236 630 236 C608 236 600 228 600 206 L600 200 C600 178 608 170 630 170 Z'
}

/** Applica una trasformazione a ogni coppia di coordinate "x y" del tracciato. */
export function mapPath(d: string, f: (x: number, y: number) => [number, number]): string {
  return d.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_m, x: string, y: string) => {
    const [nx, ny] = f(Number(x), Number(y))
    return `${round(nx)} ${round(ny)}`
  })
}

const round = (n: number) => Math.round(n * 100) / 100
const shift = (d: string) => mapPath(d, (x, y) => [x + DX, y + DY])

/** Centro orizzontale e base di Pix: punto fisso quando cambia la dimensione. */
export const PIX_ANCHOR = { x: 51, y: 226 } as const

export const SHAPES = {
  bar: shift(DEMO.bar),
  blob: shift(DEMO.blob),
  drop: shift(DEMO.drop),
  pix: shift(DEMO.pix)
}

/**
 * Forme del corpo, tutte con la base a y = 226 e centrate su x = 51
 * (coordinate dell'SVG della mascotte, dimensione media). `faceDy` sposta
 * occhi e riflesso in basso quando la forma ha la sommità più bassa.
 */
export const BODY_SHAPES: Record<PixShape, { path: string; faceDy: number }> = {
  squircle: { path: SHAPES.pix, faceDy: 0 },
  round: {
    path: 'M51 164 C68.12 164 82 177.88 82 195 C82 212.12 68.12 226 51 226 C33.88 226 20 212.12 20 195 C20 177.88 33.88 164 51 164 Z',
    faceDy: 3
  },
  tile: {
    path: 'M33 166 L69 166 C75.6 166 81 171.4 81 178 L81 214 C81 220.6 75.6 226 69 226 L33 226 C26.4 226 21 220.6 21 214 L21 178 C21 171.4 26.4 166 33 166 Z',
    faceDy: 4
  },
  egg: {
    path: 'M51 158 C68 158 80 178 80 198 C80 215 67 226 51 226 C35 226 22 215 22 198 C22 178 34 158 51 158 Z',
    faceDy: 2
  },
  soft: {
    path: 'M52 161 C71 159 84 172 82 194 C81 214 70 226 50 226 C31 226 20 214 21 194 C22 174 34 162 52 161 Z',
    faceDy: 1
  }
}

/** Corpo di Pix scalato attorno alla base (dimensioni piccola/media/grande). */
export function pixPath(scale: number, shape: PixShape = 'squircle'): string {
  return mapPath(BODY_SHAPES[shape].path, (x, y) => [PIX_ANCHOR.x + (x - PIX_ANCHOR.x) * scale, PIX_ANCHOR.y + (y - PIX_ANCHOR.y) * scale])
}

/**
 * Trasformazione SVG che porta le bozze di Pix (viewBox 100×100, corpo x 20–80,
 * y 22–88) sullo squircle del morph, per disegnare occhi, riflesso e badge.
 */
export function faceTransform(scale: number, shape: PixShape = 'squircle'): string {
  const dy = BODY_SHAPES[shape].faceDy * scale
  return `translate(${round(PIX_ANCHOR.x - 50 * scale)} ${round(PIX_ANCHOR.y - 88 * scale + dy)}) scale(${scale})`
}

export interface MorphInterpolators {
  toBlob: Interpolator
  toDrop: Interpolator
  toPix: Interpolator
  pix: string
}

const cache = new Map<string, MorphInterpolators>()

/** Interpolatori calcolati una sola volta per forma e dimensione (operazione costosa). */
export function morphFor(scale: number, shape: PixShape = 'squircle'): MorphInterpolators {
  const key = `${shape}:${scale}`
  let m = cache.get(key)
  if (!m) {
    const pix = pixPath(scale, shape)
    const opts = { maxSegmentLength: 4 }
    m = {
      toBlob: interpolate(SHAPES.bar, SHAPES.blob, opts),
      toDrop: interpolate(SHAPES.blob, SHAPES.drop, opts),
      toPix: interpolate(SHAPES.drop, pix, opts),
      pix
    }
    cache.set(key, m)
  }
  return m
}

// ---- Easing ----
export const easeIn = (t: number) => t * t
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
/** Rimbalzo elastico finale (effetto gelatina). */
export const elastic = (t: number) =>
  t === 0 || t === 1 ? t : Math.pow(2, -9 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3.2) + 1

const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

/**
 * Tracciato del corpo per un avanzamento p ∈ [0, 1]. In andata l'ultimo tratto
 * usa l'easing elastico; al ritorno un easing morbido, così l'inversione a
 * metà strada riparte dal punto in cui si trova senza scatti.
 */
export function bodyAt(m: MorphInterpolators, p: number, forward: boolean): string {
  if (p <= 0) return SHAPES.bar
  if (p >= 1) return m.pix
  if (p < 0.33) return m.toBlob(easeIn(p / 0.33))
  if (p < LAST_START) return m.toDrop(easeInOut((p - 0.33) / 0.22))
  const t = (p - LAST_START) / LAST_LEN
  return m.toPix(clamp01(forward ? elastic(t) : easeInOut(t)))
}

const LAST_START = 0.55
const LAST_LEN = 0.45

/**
 * Quando la direzione cambia durante l'ultimo tratto (dove andata e ritorno
 * usano easing diversi) ricalcola p in modo che la forma resti identica:
 * l'inversione non produce nessuno scatto.
 */
export function remapOnReverse(p: number, nowForward: boolean): number {
  if (p <= LAST_START || p >= 1) return p
  const t = (p - LAST_START) / LAST_LEN
  // Valore di forma attuale, calcolato con l'easing della direzione precedente.
  const v = clamp01(nowForward ? easeInOut(t) : elastic(t))
  let t2: number
  if (nowForward) {
    // primo t con elastic(t) >= v (la curva elastica sale fino a 1 entro t ≈ 0.24)
    t2 = 0.24
    for (let i = 0; i <= 240; i++) {
      const c = i / 1000
      if (elastic(c) >= v) {
        t2 = c
        break
      }
    }
  } else {
    t2 = v < 0.5 ? Math.sqrt(v / 2) : 1 - Math.sqrt(2 * (1 - v)) / 2
  }
  return LAST_START + t2 * LAST_LEN
}

/** Opacità di occhi e riflesso: compaiono all'80% dell'animazione. */
export const faceOpacity = (p: number) => clamp01((p - 0.8) / 0.2)
/** Opacità dell'ombra sotto Pix. */
export const shadowOpacity = (p: number) => 0.12 * clamp01((p - 0.6) / 0.4)
