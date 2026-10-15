import { useEffect, useId, useRef } from 'react'
import type { PixEyes, PixShape } from '@shared/mascot'
import { faceTransform, pixPath } from './geometry'
import { Eyes, Shine } from './Faces'
import { PEEK_DURATION_S, PEEK_SCALE, consumedBarPath, peekEyesTransform, peekFrame, peekTransform } from './peekMotion'

interface Props {
  /** Altezza (coordinate dell'SVG) a cui sbuca. */
  y: number
  scale: number
  shape: PixShape
  eyes: PixEyes
  shine: boolean
  fill: string
  /** Disegna la barra con un po' di fluido in meno (null = barra normale). */
  setBar: (d: string | null) => void
  onDone: () => void
}

/**
 * Il piccolo Pix che sbircia da dietro la barra. Va disegnato prima della
 * barra, così la barra lo copre; il filtro "goo" fonde il corpo con il collo
 * attaccato alla barra, come una goccia che si stacca. Animato con
 * requestAnimationFrame solo per la durata della sbirciata.
 */
export function Peek({ y, scale, shape, eyes, shine, fill, setBar, onDone }: Props) {
  const uid = useId().replace(/:/g, '')
  const bodyRef = useRef<SVGGElement>(null)
  const faceRef = useRef<SVGGElement>(null)
  const eyesRef = useRef<SVGGElement>(null)
  const neckRef = useRef<SVGEllipseElement>(null)
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
      const tr = peekTransform(f, y, scale)
      bodyRef.current?.setAttribute('transform', tr)
      faceRef.current?.setAttribute('transform', tr)
      eyesRef.current?.setAttribute('transform', peekEyesTransform(f))
      neckRef.current?.setAttribute('rx', String(6 * f.neck))
      neckRef.current?.setAttribute('ry', String(12 * PEEK_SCALE * scale * f.neck))
      bar.current(consumedBarPath(f.consumed, y))
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      bar.current(null)
    }
  }, [y, scale])

  const hidden = peekTransform(peekFrame(0), y, scale)
  return (
    <g className="peek" pointerEvents="none" aria-hidden="true" clipPath={`url(#peek-clip-${uid})`}>
      <defs>
        <clipPath id={`peek-clip-${uid}`}>
          {/* Niente oltre il bordo destro della barra: sbuca da dietro. */}
          <rect x="0" y="0" width="95" height="240" />
        </clipPath>
        <filter id={`peek-goo-${uid}`} x="0" y="0" width="120" height="240" filterUnits="userSpaceOnUse">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="over" />
        </filter>
      </defs>
      <g filter={`url(#peek-goo-${uid})`}>
        <ellipse ref={neckRef} cx="90" cy={y} rx="0" ry="0" fill={fill} />
        <g ref={bodyRef} transform={hidden}>
          <path d={pixPath(1, shape)} fill={fill} />
        </g>
      </g>
      <g ref={faceRef} transform={hidden}>
        <g transform={faceTransform(1, shape)}>
          {shine && <Shine />}
          <g ref={eyesRef}>
            <Eyes mood="normal" style={eyes} />
          </g>
        </g>
      </g>
    </g>
  )
}
