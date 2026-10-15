import type { PixAccessory, PixShape, PixTransform } from '@shared/mascot'
import { bodyAt, easeInOut, elastic, faceOpacity, morphTo, remapOnReverse, shadowOpacity, type MorphInterpolators } from './geometry'
import { lerpPoints, shapePoints, toPath, type Pt } from './shapes'

export interface MorphElements {
  body: SVGPathElement
  face: SVGGElement
  shadow: SVGEllipseElement
}

const FORWARD_MS = 1100
const BACKWARD_MS = 700
/** Durate delle trasformazioni del corpo (corna, cuore…). */
const SHAPE_IN_MS = 900
const SHAPE_OUT_MS = 650
/** Prima di tornare barra, una trasformazione in corso si riassorbe in fretta. */
const SHAPE_QUICK_MS = 250
/** Limite al passo per frame: dopo un blocco della pagina non si salta a fine animazione. */
const MAX_STEP_MS = 40

interface ShapeAnim {
  from: Pt[]
  to: Pt[]
  start: number
  duration: number
  ease: (t: number) => number
  then?: () => void
}

/**
 * Animazione del corpo di Pix, un unico fluido:
 * - barra ↔ Pix guidata da un avanzamento p (0 = barra, 1 = Pix); cambiare
 *   direzione a metà riparte dal p corrente, senza scatti;
 * - quando Pix è formato, il contorno può trasformarsi (corna, cuore,
 *   gocce…) e poi tornare com'era, con un rimbalzo elastico.
 * Il ciclo requestAnimationFrame è attivo solo mentre qualcosa si muove.
 */
export class MorphController {
  private p = 0
  private target: 0 | 1 = 0
  private raf = 0
  private last = 0
  private m: MorphInterpolators
  /** Forma "a riposo" di Pix formato (con l'eventuale forma fissa). */
  private rest: Pt[]
  /** Forma disegnata ora quando Pix è formato. */
  private current: Pt[]
  private shapeAnim: ShapeAnim | null = null
  private shapeRaf = 0
  private transformed: PixTransform | null = null
  private scale: number
  private shape: PixShape

  constructor(
    private readonly els: MorphElements,
    scale: number,
    shape: PixShape,
    private accessory: PixAccessory,
    private readonly onSettled: (formed: boolean) => void
  ) {
    this.scale = scale
    this.shape = shape
    this.rest = shapePoints(scale, shape, accessory)
    this.current = this.rest
    this.m = morphTo(toPath(this.rest))
    this.render()
  }

  get formed(): boolean {
    return this.p >= 1
  }

  setShape(scale: number, shape: PixShape, accessory: PixAccessory): void {
    const changed = scale !== this.scale || shape !== this.shape || accessory !== this.accessory
    this.scale = scale
    this.shape = shape
    this.accessory = accessory
    this.rest = shapePoints(scale, shape, accessory)
    this.m = morphTo(toPath(this.rest))
    if (!changed) return
    if (this.formed && !this.raf) {
      // Cambio di forma fissa con Pix visibile: anche questo è un morph fluido.
      this.animateShape(this.transformed ? shapePoints(scale, shape, this.transformed) : this.rest, SHAPE_IN_MS, elastic)
    } else {
      this.current = this.rest
      this.render()
    }
  }

  /** Va verso Pix (1) o verso la barra (0). `instant` salta l'animazione (movimento ridotto). */
  go(target: 0 | 1, instant = false): void {
    // Prima di tornare barra, il corpo riprende la sua forma.
    if (target === 0 && this.formed && this.current !== this.rest && !instant) {
      this.target = 0
      this.transformed = null
      this.animateShape(this.rest, SHAPE_QUICK_MS, easeInOut, () => {
        if (this.target === 0) this.go(0)
      })
      return
    }
    if (target !== this.target && this.raf) this.p = remapOnReverse(this.p, target === 1)
    this.target = target
    if (instant) {
      this.stop()
      this.stopShape()
      this.transformed = null
      this.current = this.rest
      this.p = target
      this.render()
      this.onSettled(target === 1)
      return
    }
    if (this.p === target) return
    this.stopShape()
    this.current = this.rest
    if (!this.raf) {
      this.last = 0
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  /** Trasforma il corpo (null = torna alla forma a riposo). Funziona solo con Pix formato. */
  transform(kind: PixTransform | null, instant = false): void {
    if (kind === this.transformed) return
    this.transformed = kind
    if (!this.formed || this.raf || this.target === 0) return
    const to = kind ? shapePoints(this.scale, this.shape, kind) : this.rest
    if (instant) {
      this.stopShape()
      this.current = to
      this.render()
      return
    }
    this.animateShape(to, kind ? SHAPE_IN_MS : SHAPE_OUT_MS, kind ? elastic : (t) => 1 - (1 - t) ** 3)
  }

  dispose(): void {
    this.stop()
    this.stopShape()
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private stopShape(): void {
    if (this.shapeRaf) cancelAnimationFrame(this.shapeRaf)
    this.shapeRaf = 0
    this.shapeAnim = null
  }

  /** Morph del contorno dalla forma disegnata ora verso `to` (anche a metà di un'altra trasformazione). */
  private animateShape(to: Pt[], duration: number, ease: (t: number) => number, then?: () => void): void {
    this.stopShape()
    this.shapeAnim = { from: this.current, to, start: 0, duration, ease, then }
    this.shapeRaf = requestAnimationFrame(this.shapeFrame)
  }

  private shapeFrame = (ts: number): void => {
    const a = this.shapeAnim
    if (!a) return
    if (!a.start) a.start = ts
    const t = Math.min(1, (ts - a.start) / a.duration)
    this.current = t >= 1 ? a.to : lerpPoints(a.from, a.to, a.ease(t))
    this.els.body.setAttribute('d', toPath(this.current))
    if (t < 1) {
      this.shapeRaf = requestAnimationFrame(this.shapeFrame)
    } else {
      this.shapeRaf = 0
      this.shapeAnim = null
      a.then?.()
    }
  }

  private frame = (ts: number): void => {
    const dt = this.last ? Math.min(MAX_STEP_MS, ts - this.last) : 16
    this.last = ts
    const forward = this.target === 1
    this.p += forward ? dt / FORWARD_MS : -dt / BACKWARD_MS
    this.p = Math.max(0, Math.min(1, this.p))
    this.render()
    if (this.p !== this.target) {
      this.raf = requestAnimationFrame(this.frame)
    } else {
      this.raf = 0
      this.onSettled(forward)
      // Una trasformazione chiesta durante il morph parte appena Pix è formato.
      if (forward && this.transformed) {
        const kind = this.transformed
        this.transformed = null
        this.transform(kind)
      }
    }
  }

  private render(): void {
    const { body, face, shadow } = this.els
    body.setAttribute('d', this.p >= 1 ? toPath(this.current) : bodyAt(this.m, this.p, this.target === 1))
    face.setAttribute('opacity', faceOpacity(this.p).toFixed(2))
    shadow.setAttribute('opacity', shadowOpacity(this.p).toFixed(3))
  }
}
