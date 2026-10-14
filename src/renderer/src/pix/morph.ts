import type { PixShape } from '@shared/mascot'
import { bodyAt, faceOpacity, morphFor, remapOnReverse, shadowOpacity, type MorphInterpolators } from './geometry'

export interface MorphElements {
  body: SVGPathElement
  face: SVGGElement
  shadow: SVGEllipseElement
}

const FORWARD_MS = 1100
const BACKWARD_MS = 700
/** Limite al passo per frame: dopo un blocco della pagina non si salta a fine animazione. */
const MAX_STEP_MS = 40

/**
 * Animazione barra ↔ Pix guidata da un unico avanzamento p (0 = barra, 1 = Pix).
 * Cambiare direzione a metà animazione riparte dal p corrente, senza scatti.
 * Il ciclo requestAnimationFrame è attivo solo mentre p si muove: da fermo
 * non consuma CPU.
 */
export class MorphController {
  private p = 0
  private target: 0 | 1 = 0
  private raf = 0
  private last = 0
  private m: MorphInterpolators

  constructor(
    private readonly els: MorphElements,
    scale: number,
    shape: PixShape,
    private readonly onSettled: (formed: boolean) => void
  ) {
    this.m = morphFor(scale, shape)
    this.render()
  }

  get progress(): number {
    return this.p
  }

  get formed(): boolean {
    return this.p >= 1
  }

  setShape(scale: number, shape: PixShape): void {
    this.m = morphFor(scale, shape)
    this.render()
  }

  /** Va verso Pix (1) o verso la barra (0). `instant` salta l'animazione (movimento ridotto). */
  go(target: 0 | 1, instant = false): void {
    if (target !== this.target && this.raf) this.p = remapOnReverse(this.p, target === 1)
    this.target = target
    if (instant) {
      this.stop()
      this.p = target
      this.render()
      this.onSettled(target === 1)
      return
    }
    if (this.p === target) return
    if (!this.raf) {
      this.last = 0
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  dispose(): void {
    this.stop()
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private frame = (ts: number): void => {
    const dt = this.last ? Math.min(MAX_STEP_MS, ts - this.last) : 16
    this.last = ts
    const forward = this.target === 1
    this.p += (forward ? dt / FORWARD_MS : -dt / BACKWARD_MS)
    this.p = Math.max(0, Math.min(1, this.p))
    this.render()
    if (this.p !== this.target) {
      this.raf = requestAnimationFrame(this.frame)
    } else {
      this.raf = 0
      this.onSettled(forward)
    }
  }

  private render(): void {
    const { body, face, shadow } = this.els
    body.setAttribute('d', bodyAt(this.m, this.p, this.target === 1))
    face.setAttribute('opacity', faceOpacity(this.p).toFixed(2))
    shadow.setAttribute('opacity', shadowOpacity(this.p).toFixed(3))
  }
}
