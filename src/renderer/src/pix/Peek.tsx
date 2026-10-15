import { useEffect, useRef, type MutableRefObject } from 'react'
import type { PixEyes, PixShape } from '@shared/mascot'
import { Badge, Eyes, Shine } from './Faces'
import { VIEW } from './geometry'
import {
  PEEK_DURATION_S,
  PEEK_SCARE_FROM_S,
  PEEK_SCARE_UNTIL_S,
  SCARE_DURATION_S,
  headOf,
  peekBodyPath,
  peekEyesTransform,
  peekFaceTransform,
  peekFrame,
  scaredFrame,
  type PeekFrame
} from './peekMotion'

interface Props {
  /** Altezza (coordinate dell'SVG) a cui sbuca dal lato. */
  y: number
  scale: number
  shape: PixShape
  eyes: PixEyes
  shine: boolean
  /** Disegna il corpo (la barra) con la goccia di Pix; null = barra normale. */
  setBar: (d: string | null) => void
  /** Riceve la funzione che lo spaventa (es. se tocchi la testa). */
  scareRef: MutableRefObject<(() => void) | null>
  onDone: () => void
}

/** Entro questa distanza (px) Pix guarda il cursore. */
const LOOK_RADIUS = 170
/** Il cursore che si avvicina più veloce di così (px/s) ed entro SCARE_RADIUS lo spaventa. */
const SCARE_SPEED = 260
const SCARE_RADIUS = 180
const EYE_RANGE = 3

/**
 * La sbirciata: il corpo è la barra stessa, che si gonfia in una goccia e
 * diventa la testa di Pix (vedi peekMotion). Qui si disegnano solo gli occhi.
 * Pix guarda il cursore se è vicino; se gli corri incontro (o lo tocchi)
 * sobbalza e viene risucchiato di colpo. Animata con requestAnimationFrame
 * solo per la durata della sbirciata.
 */
export function Peek({ y, scale, shape, eyes, shine, setBar, scareRef, onDone }: Props) {
  const faceRef = useRef<SVGGElement>(null)
  const eyesRef = useRef<SVGGElement>(null)
  const calmRef = useRef<SVGGElement>(null)
  const scaredRef = useRef<SVGGElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  const bar = useRef(setBar)
  bar.current = setBar

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    let t = 0
    let frame: PeekFrame = peekFrame(0)
    /** Spavento: istante e fotogramma da cui parte. */
    let scared: { at: number; from: PeekFrame } | null = null
    let pointer: { x: number; y: number; at: number } | null = null
    let prev: { d: number; at: number } | null = null
    let head = { x: -999, y: -999, r: 0 }

    const scare = () => {
      if (scared || t < PEEK_SCARE_FROM_S || t >= PEEK_SCARE_UNTIL_S) return
      scared = { at: performance.now(), from: frame }
    }
    scareRef.current = scare

    // Posizione del cursore nelle coordinate dell'SVG (la finestra inoltra i movimenti anche da trasparente).
    const onMove = (e: MouseEvent) => {
      const svg = faceRef.current?.ownerSVGElement
      if (!svg) return
      const r = svg.getBoundingClientRect()
      const now = performance.now()
      pointer = { x: ((e.clientX - r.left) / r.width) * VIEW.width, y: ((e.clientY - r.top) / r.height) * VIEW.height, at: now }
      const d = Math.hypot(pointer.x - head.x, pointer.y - head.y)
      // Corre verso di lui, oppure lo tocca: si spaventa.
      if (prev && now - prev.at > 0 && now - prev.at < 120) {
        const speed = ((prev.d - d) / (now - prev.at)) * 1000
        if (d < SCARE_RADIUS && speed > SCARE_SPEED) scare()
      }
      if (d < head.r + 4) scare()
      prev = { d, at: now }
    }
    document.addEventListener('mousemove', onMove, { passive: true })

    const finish = () => {
      bar.current(null)
      done.current()
    }

    const step = (now: number) => {
      try {
        if (scared) {
          const tau = (now - scared.at) / 1000
          if (tau >= SCARE_DURATION_S) return finish()
          frame = scaredFrame(scared.from, tau)
        } else {
          t = (now - start) / 1000
          if (t >= PEEK_DURATION_S) return finish()
          frame = peekFrame(t)
        }
        const f = { ...frame }
        const h = headOf(f, y, scale, shape)
        head = { x: h.cx, y: h.cy, r: Math.max(h.a, h.b) }
        // Guarda il cursore se è vicino (finché è tranquillo).
        if (!scared && pointer && t > 0.8 && t < PEEK_SCARE_UNTIL_S - 0.5 && now - pointer.at < 4000) {
          const dx = pointer.x - h.cx
          const dy = pointer.y - h.cy
          const dist = Math.hypot(dx, dy)
          if (dist < LOOK_RADIUS && dist > 1) {
            const k = Math.min(1, dist / 60) * EYE_RANGE
            f.eyeX = (dx / dist) * k
            f.eyeY = (dy / dist) * k
          }
        }
        bar.current(peekBodyPath(f, y, scale, shape))
        const face = faceRef.current
        if (face) {
          face.setAttribute('transform', peekFaceTransform(f, y, scale, shape))
          face.setAttribute('opacity', f.face.toFixed(3))
        }
        eyesRef.current?.setAttribute('transform', peekEyesTransform(f))
        calmRef.current?.setAttribute('opacity', (1 - f.startle).toFixed(3))
        scaredRef.current?.setAttribute('opacity', f.startle.toFixed(3))
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
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousemove', onMove)
      if (scareRef.current === scare) scareRef.current = null
      bar.current(null)
    }
  }, [y, scale, shape])

  return (
    <g ref={faceRef} className="peek" pointerEvents="none" aria-hidden="true" opacity="0">
      {shine && <Shine />}
      <g ref={eyesRef}>
        <g ref={calmRef}>
          <Eyes mood="normal" style={eyes} />
        </g>
      </g>
      {/* Spavento: occhi tondi, bocca a "o" e punto esclamativo */}
      <g ref={scaredRef} opacity="0">
        <Eyes mood="alert" style={eyes} />
        <Badge mood="alert" />
      </g>
    </g>
  )
}
