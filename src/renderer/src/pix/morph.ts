import type { PixShape, PixTransform } from '@shared/mascot'
import { SHAPES, bodyAt, faceOpacity, morphFor, remapOnReverse, shadowOpacity, type MorphInterpolators } from './geometry'
import { liveShape, restBody, toPath, type Body } from './shapes'

export interface MorphElements {
  body: SVGPathElement
  face: SVGGElement
  shadow: SVGEllipseElement
}

const FORWARD_MS = 1100
const BACKWARD_MS = 700
/** Animazioni del corpo: entrata elastica, movimento, rientro morbido. */
const PLAY_IN_S = 0.6
const PLAY_HOLD_S = 3.4
const PLAY_OUT_S = 0.7
/** Rientro veloce (es. prima di tornare barra). */
const QUICK_OUT_S = 0.25
/** Limite al passo per frame: dopo un blocco della pagina non si salta a fine animazione. */
const MAX_STEP_MS = 40

/** Entrata con un piccolo superamento (effetto gelatina). */
const easeOutBack = (x: number) => {
  const c = 1.9
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
}

interface Play {
  kind: PixTransform
  start: number
  loop: boolean
  /** Inizio del rientro (secondi dall'avvio) e ampiezza da cui rientra. */
  outAt: number | null
  outFrom: number
  outDur: number
  then?: () => void
}

/**
 * Animazione del corpo di Pix, un unico fluido:
 * - barra ↔ Pix guidata da un avanzamento p (0 = barra, 1 = Pix); cambiare
 *   direzione a metà riparte dal p corrente, senza scatti;
 * - quando Pix è formato, il corpo può "giocare": si deforma e si muove
 *   (onde, tentacoli, battito…) e poi torna com'era.
 * Il ciclo requestAnimationFrame è attivo solo mentre qualcosa si muove.
 */
export class MorphController {
  private p = 0
  private target: 0 | 1 = 0
  private raf = 0
  private last = 0
  private m: MorphInterpolators
  private body: Body
  private play: Play | null = null
  private playRaf = 0
  private pending: { kind: PixTransform; loop: boolean } | null = null

  constructor(
    private readonly els: MorphElements,
    private scale: number,
    private shape: PixShape,
    private readonly onSettled: (formed: boolean) => void
  ) {
    this.m = morphFor(scale, shape)
    this.body = restBody(scale, shape)
    this.render()
  }

  get formed(): boolean {
    return this.p >= 1
  }

  get playing(): PixTransform | null {
    return this.play && this.play.outAt === null ? this.play.kind : null
  }

  setShape(scale: number, shape: PixShape): void {
    this.scale = scale
    this.shape = shape
    this.m = morphFor(scale, shape)
    this.body = restBody(scale, shape)
    if (!this.play) this.render()
  }

  /** Va verso Pix (1) o verso la barra (0). `instant` salta l'animazione (movimento ridotto). */
  go(target: 0 | 1, instant = false): void {
    // Prima di tornare barra, il corpo smette di giocare e riprende la sua forma.
    if (target === 0 && this.play && !instant) {
      this.target = 0
      this.pending = null
      this.stopPlay(QUICK_OUT_S, () => {
        if (this.target === 0) this.go(0)
      })
      return
    }
    if (target !== this.target && this.raf) this.p = remapOnReverse(this.p, target === 1)
    this.target = target
    if (instant) {
      this.stop()
      this.cancelPlay()
      this.p = target
      this.render()
      this.onSettled(target === 1)
      return
    }
    if (this.p === target) return
    this.cancelPlay()
    if (!this.raf) {
      this.last = 0
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  /**
   * Fa "giocare" il corpo con un'animazione. `loop`: continua finché non
   * viene fermata (es. le antenne mentre l'AI pensa). Se Pix non è ancora
   * formato, parte appena lo è.
   */
  start(kind: PixTransform, loop = false): void {
    if (!this.formed || this.raf || this.target === 0) {
      this.pending = { kind, loop }
      return
    }
    // Un'animazione in corso cede il posto con un rientro rapido.
    if (this.play) {
      this.stopPlay(QUICK_OUT_S, () => this.start(kind, loop))
      return
    }
    this.play = { kind, start: 0, loop, outAt: null, outFrom: 1, outDur: PLAY_OUT_S }
    this.playRaf = requestAnimationFrame(this.playFrame)
  }

  /** Ferma l'animazione con un rientro morbido. */
  stopPlay(duration = PLAY_OUT_S, then?: () => void): void {
    this.pending = null
    const pl = this.play
    if (!pl) {
      then?.()
      return
    }
    if (pl.outAt !== null) {
      // Sta già rientrando: aggiunge solo cosa fare alla fine.
      const prev = pl.then
      pl.then = () => {
        prev?.()
        then?.()
      }
      return
    }
    const now = pl.start ? (performance.now() - pl.start) / 1000 : 0
    pl.outFrom = this.amp(pl, now)
    pl.outAt = now
    pl.outDur = duration
    pl.then = then
  }

  /**
   * Forma della barra a riposo modificata dall'esterno (la sbirciata le
   * "consuma" un po' di fluido). Ignorata se il corpo non è barra ferma;
   * null rimette la barra normale.
   */
  setBar(d: string | null): void {
    if (this.p !== 0 || this.target !== 0 || this.raf || this.play) return
    this.els.body.setAttribute('d', d ?? SHAPES.bar)
  }

  dispose(): void {
    this.stop()
    this.cancelPlay()
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private cancelPlay(): void {
    if (this.playRaf) cancelAnimationFrame(this.playRaf)
    this.playRaf = 0
    this.play = null
  }

  /** Ampiezza dell'animazione all'istante `t` (secondi dall'avvio). */
  private amp(pl: Play, t: number): number {
    if (pl.outAt !== null) {
      const x = Math.min(1, (t - pl.outAt) / pl.outDur)
      return pl.outFrom * (1 - (1 - (1 - x) ** 3))
    }
    return t < PLAY_IN_S ? easeOutBack(t / PLAY_IN_S) : 1
  }

  private playFrame = (ts: number): void => {
    const pl = this.play
    if (!pl) return
    if (!pl.start) pl.start = ts
    const t = (ts - pl.start) / 1000
    if (!pl.loop && pl.outAt === null && t >= PLAY_IN_S + PLAY_HOLD_S) {
      pl.outFrom = 1
      pl.outAt = t
      pl.outDur = PLAY_OUT_S
    }
    const finished = pl.outAt !== null && t >= pl.outAt + pl.outDur
    if (finished) {
      this.playRaf = 0
      this.play = null
      this.render()
      pl.then?.()
      return
    }
    this.els.body.setAttribute('d', toPath(liveShape(this.body, pl.kind, t, this.amp(pl, t))))
    this.playRaf = requestAnimationFrame(this.playFrame)
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
      // Un'animazione chiesta durante il morph parte appena Pix è formato.
      if (forward && this.pending) {
        const { kind, loop } = this.pending
        this.pending = null
        this.start(kind, loop)
      }
    }
  }

  private render(): void {
    const { body, face, shadow } = this.els
    body.setAttribute('d', bodyAt(this.m, this.p, this.target === 1))
    face.setAttribute('opacity', faceOpacity(this.p).toFixed(2))
    shadow.setAttribute('opacity', shadowOpacity(this.p).toFixed(3))
  }
}
