import { useEffect, useRef } from 'react'
import type { PixEyes, PixShape } from '@shared/mascot'
import { Eyes, Shine } from './Faces'
import { PEEK_DURATION_S, peekBodyPath, peekEyesTransform, peekFaceTransform, peekFrame } from './peekMotion'

interface Props {
  /** Altezza (coordinate dell'SVG) a cui sbuca. */
  y: number
  scale: number
  shape: PixShape
  eyes: PixEyes
  shine: boolean
  /** Disegna il corpo (la barra) con la goccia di Pix; null = barra normale. */
  setBar: (d: string | null) => void
  onDone: () => void
}

/**
 * La sbirciata: il corpo è la barra stessa, che si gonfia in una goccia e
 * diventa la testa di Pix (vedi peekMotion). Qui si disegnano solo gli occhi.
 * Animata con requestAnimationFrame solo per la durata della sbirciata.
 */
export function Peek({ y, scale, shape, eyes, shine, setBar, onDone }: Props) {
  const faceRef = useRef<SVGGElement>(null)
  const eyesRef = useRef<SVGGElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  const bar = useRef(setBar)
  bar.current = setBar

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const frame = (now: number) => {
      const t = (now - start) / 1000
      if (t >= PEEK_DURATION_S) {
        bar.current(null)
        done.current()
        return
      }
      const f = peekFrame(t)
      bar.current(peekBodyPath(f, y, scale, shape))
      const face = faceRef.current
      if (face) {
        face.setAttribute('transform', peekFaceTransform(f, y, scale, shape))
        face.setAttribute('opacity', f.face.toFixed(3))
      }
      eyesRef.current?.setAttribute('transform', peekEyesTransform(f))
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      bar.current(null)
    }
  }, [y, scale, shape])

  return (
    <g ref={faceRef} className="peek" pointerEvents="none" aria-hidden="true" opacity="0">
      {shine && <Shine />}
      <g ref={eyesRef}>
        <Eyes mood="normal" style={eyes} />
      </g>
    </g>
  )
}
