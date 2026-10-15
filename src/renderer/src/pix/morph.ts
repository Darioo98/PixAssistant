import type { PixShape, PixTransform } from '@shared/mascot'
import { bodyAt, faceOpacity, morphFor, remapOnReverse, shadowOpacity, type MorphInterpolators } from './geometry'
import { PEEK_RADIUS, barBody, liveShape, peekShape, restBody, toPath, type Body } from './shapes'
import { SHAPES } from './geometry'

export interface MorphElements {
  body: SVGPathElement
  face: SVGGElement
  shadow: SVGEllipseElement
  /** Occhietti che compaiono quando Pix spia dalla barra. */
  peekEyes?: SVGGElement | null
}

/** Durata della sbirciata: esce, si guarda intorno, sbatte le palpebre, rientra. */
const PEEK_IN_S = 0.55
const PEEK_LOOK_S = 2.2
const PEEK_OUT_S = 0.5
const PEEK_QUICK_S = 0.15

interface Peek {
  y0: number
  start: number
  outAt: number | null
  outFrom: number
  outDur: number
  then?: () => void
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
  private peekState: Peek | null = null
  private peekRaf = 0

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
    // Se stava spiando, la bolla rientra in un attimo e poi parte il morph.
    if (this.peekState) {
      if (target === 1 && !instant) {
        this.target = 1
        this.endPeek(PEEK_QUICK_S, () => {
          if (this.target === 1) this.go(1)
        })
        return
      }
      this.cancelPeek()
    }
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

  /** Pix spia dalla barra (solo a pannello chiuso, con la barra ferma). */
  peek(): void {
    if (this.p !== 0 || this.raf || this.target !== 0 || this.peekState) return
    // Altezza casuale lungo la barra, lontano dalle estremità.
    const y0 = 50 + 40 + Math.random() * (180 - 80)
    this.peekState = { y0, start: 0, outAt: null, outFrom: 1, outDur: PEEK_OUT_S }
    this.peekRaf = requestAnimationFrame(this.peekFrame)
  }

  private endPeek(duration: number, then?: () => void): void {
    const pk = this.peekState
    if (!pk) {
      then?.()
      return
    }
    const now = pk.start ? (performance.now() - pk.start) / 1000 : 0
    pk.outFrom = this.peekAmp(pk, now)
    pk.outAt = now
    pk.outDur = duration
    pk.then = then
  }

  private cancelPeek(): void {
    if (this.peekRaf) cancelAnimationFrame(this.peekRaf)
    this.peekRaf = 0
    this.peekState = null
    this.els.peekEyes?.setAttribute('opacity', '0')
  }

  private peekAmp(pk: Peek, t: number): number {
    if (pk.outAt !== null) {
      const x = Math.min(1, (t - pk.outAt) / pk.outDur)
      return pk.outFrom * (1 - x) ** 2
    }
    return t < PEEK_IN_S ? easeOutBack(t / PEEK_IN_S) : 1
  }

  private peekFrame = (ts: number): void => {
    const pk = this.peekState
    if (!pk) return
    if (!pk.start) pk.start = ts
    const t = (ts - pk.start) / 1000
    if (pk.outAt === null && t >= PEEK_IN_S + PEEK_LOOK_S) {
      pk.outFrom = 1
      pk.outAt = t
      pk.outDur = PEEK_OUT_S
    }
    if (pk.outAt !== null && t >= pk.outAt + pk.outDur) {
      this.peekRaf = 0
      this.peekState = null
      this.els.peekEyes?.setAttribute('opacity', '0')
      this.render()
      pk.then?.()
      return
    }
    const a = this.peekAmp(pk, t)
    this.els.body.setAttribute('d', toPath(peekShape(barBody(SHAPES.bar), pk.y0, a)))
    const eyes = this.els.peekEyes
    if (eyes) {
      // Occhietti al centro della bolla: guardano a sinistra, a destra e sbattono le palpebre.
      const look = t < PEEK_IN_S ? 0 : Math.sin((t - PEEK_IN_S) * 2.6) * 2.2
      const blinkPhase = t - PEEK_IN_S - 1.3
      const blink = blinkPhase > 0 && blinkPhase < 0.14 ? 0.15 : 1
      const x = 88 - PEEK_RADIUS * 0.7 * a + look
      eyes.setAttribute('transform', `translate(${x.toFixed(2)} ${pk.y0.toFixed(2)}) scale(1 ${blink})`)
      eyes.setAttribute('opacity', Math.max(0, Math.min(1, (a - 0.55) / 0.35)).toFixed(2))
    }
    this.peekRaf = requestAnimationFrame(this.peekFrame)
  }

  dispose(): void {
    this.stop()
    this.cancelPlay()
    this.cancelPeek()
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
