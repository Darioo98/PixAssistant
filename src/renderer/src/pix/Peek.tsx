import { useEffect, useRef } from 'react'
import type { PixEyes, PixShape } from '@shared/mascot'
import { Eyes, Shine } from './Faces'
import { VIEW } from './geometry'
import {
  PEEK_DURATION_S,
  PEEK_SCARE_FROM_S,
  PEEK_SCARED_AT_S,
  headOf,
  peekBodyPath,
  peekEyesTransform,
  peekFaceTransform,
  peekFrame,
  type PeekVariant
} from './peekMotion'

interface Props {
  /** Altezza (coordinate dell'SVG) a cui sbuca dal lato. */
  y: number
  variant: PeekVariant
  scale: number
  shape: PixShape
  eyes: PixEyes
  shine: boolean
  /** Disegna il corpo (la barra) con la goccia di Pix; null = barra normale. */
  setBar: (d: string | null) => void
  onDone: () => void
}

/** Entro questa distanza (px) Pix guarda il cursore. */
const LOOK_RADIUS = 170
/** Il cursore che si avvicina più veloce di così (px/s) e più vicino di SCARE_RADIUS lo spaventa. */
const SCARE_SPEED = 420
const SCARE_RADIUS = 130
const EYE_RANGE = 3

/**
 * La sbirciata: il corpo è la barra stessa, che si gonfia in una goccia e
 * diventa la testa di Pix (vedi peekMotion). Qui si disegnano solo gli occhi.
 * Pix guarda il cursore se è vicino e, se gli corri incontro, si spaventa e
 * rientra di colpo. Animata con requestAnimationFrame solo per la durata della sbirciata.
 */
export function Peek({ y, variant, scale, shape, eyes, shine, setBar, onDone }: Props) {
  const faceRef = useRef<SVGGElement>(null)
  const eyesRef = useRef<SVGGElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  const bar = useRef(setBar)
  bar.current = setBar

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    /** Secondi aggiunti al tempo quando si spaventa (salta alla paura). */
    let skip = 0
    let pointer: { x: number; y: number; at: number } | null = null
    let lastDist: { d: number; at: number } | null = null
    let head = { x: 0, y: 0 }

    // Posizione del cursore nelle coordinate dell'SVG (la finestra inoltra i movimenti anche da trasparente).
    const onMove = (e: MouseEvent) => {
      const svg = faceRef.current?.ownerSVGElement
      if (!svg) return
      const r = svg.getBoundingClientRect()
      pointer = { x: ((e.clientX - r.left) / r.width) * VIEW.width, y: ((e.clientY - r.top) / r.height) * VIEW.height, at: performance.now() }
    }
    document.addEventListener('mousemove', onMove, { passive: true })

    const frame = (now: number) => {
      let t = (now - start) / 1000 + skip
      if (t >= PEEK_DURATION_S) {
        bar.current(null)
        done.current()
        return
      }
      try {
        // Spavento: il cursore arriva di corsa mentre Pix è fuori.
        if (pointer && t > PEEK_SCARE_FROM_S && t < PEEK_SCARED_AT_S) {
          const d = Math.hypot(pointer.x - head.x, pointer.y - head.y)
          if (lastDist && now > lastDist.at) {
            const speed = ((lastDist.d - d) / (now - lastDist.at)) * 1000
            if (d < SCARE_RADIUS && speed > SCARE_SPEED) {
              skip += PEEK_SCARED_AT_S - t
              t = PEEK_SCARED_AT_S
            }
          }
          lastDist = { d, at: now }
        }

        const f = peekFrame(t)
        const h = headOf(f, y, scale, shape, variant)
        head = { x: h.cx, y: h.cy }
        // Guarda il cursore se è vicino (finché non ha paura).
        if (pointer && t > 0.8 && t < PEEK_SCARED_AT_S - 0.3 && now - pointer.at < 4000) {
          const dx = pointer.x - h.cx
          const dy = pointer.y - h.cy
          const dist = Math.hypot(dx, dy)
          if (dist < LOOK_RADIUS && dist > 1) {
            const k = Math.min(1, dist / 60) * EYE_RANGE
            f.eyeX = (dx / dist) * k
            f.eyeY = (dy / dist) * k
          }
        }
        bar.current(peekBodyPath(f, y, scale, shape, variant))
        const face = faceRef.current
        if (face) {
          face.setAttribute('transform', peekFaceTransform(f, y, scale, shape, variant))
          face.setAttribute('opacity', f.face.toFixed(3))
        }
        eyesRef.current?.setAttribute('transform', peekEyesTransform(f))
      } catch (err) {
        // Una sbirciata andata storta non deve mai far sparire Pix: si chiude e basta.
        console.error('Sbirciata interrotta', err)
        try {
          bar.current(null)
        } catch {
          // barra già a posto
        }
        done.current()
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousemove', onMove)
      bar.current(null)
    }
  }, [y, variant, scale, shape])

  return (
    <g ref={faceRef} className="peek" pointerEvents="none" aria-hidden="true" opacity="0">
      {shine && <Shine />}
      <g ref={eyesRef}>
        <Eyes mood="normal" style={eyes} />
      </g>
    </g>
  )
}
