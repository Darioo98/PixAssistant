import { useEffect, useRef, type RefObject } from 'react'
import { PIX_ANCHOR } from './geometry'

/**
 * Sole: una luce morbida entra da destra e accarezza Pix (il bordo verso la luce
 * si fa dorato); lui socchiude gli occhi, beato, e si gode il calduccio.
 */

/** Copia del contorno del corpo, aggiornata a ogni fotogramma (per la velatura dorata). */
export function BodyTint({ source, className, fill }: { source: RefObject<SVGPathElement | null>; className: string; fill: string }) {
  const ref = useRef<SVGPathElement>(null)
  useEffect(() => {
    let raf = 0
    const step = () => {
      const d = source.current?.getAttribute('d')
      if (d && ref.current && ref.current.getAttribute('d') !== d) ref.current.setAttribute('d', d)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [source])
  return <path ref={ref} className={className} fill={fill} pointerEvents="none" />
}

/** Sfumatura del bordo illuminato e sfocatura del fascio di luce. */
export function SunDefs({ id, scale: s }: { id: string; scale: number }) {
  return (
    <defs>
      <linearGradient id={`${id}-rim`} x1="1" y1="0.1" x2="0.35" y2="0.75">
        <stop offset="0" stopColor="#ffd25e" stopOpacity="0.85" />
        <stop offset="0.45" stopColor="#ffd25e" stopOpacity="0.25" />
        <stop offset="1" stopColor="#ffd25e" stopOpacity="0" />
      </linearGradient>
      <filter id={`${id}-light`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={9 * s} />
      </filter>
    </defs>
  )
}

/** Un fascio di luce largo e sfocato da destra, senza bordi visibili, e qualche pulviscolo. */
export function SoftLight({ id, scale: s }: { id: string; scale: number }) {
  const ax = PIX_ANCHOR.x
  const ay = PIX_ANCHOR.y
  const d = `M${ax + 64 * s} ${ay - 150 * s} L${ax + 64 * s} ${ay - 112 * s} L${ax - 4 * s} ${ay - 6 * s} L${ax - 40 * s} ${ay - 40 * s} Z`
  const motes = [
    [30, -104, 0],
    [18, -86, 0.7],
    [40, -78, 1.3],
    [8, -70, 0.4]
  ] as const
  return (
    <g className="sky-sun" pointerEvents="none">
      <linearGradient id={`${id}-shaft`} gradientUnits="userSpaceOnUse" x1={ax + 64 * s} y1={ay - 130 * s} x2={ax - 10 * s} y2={ay - 30 * s}>
        <stop offset="0" stopColor="#ffd95a" stopOpacity="0.7" />
        <stop offset="1" stopColor="#ffd95a" stopOpacity="0" />
      </linearGradient>
      <path className="sun-shaft" d={d} fill={`url(#${id}-shaft)`} filter={`url(#${id}-light)`} />
      {motes.map(([dx, dy, delay], i) => (
        <circle
          key={i}
          className="sun-dust"
          style={{ ['--dust-delay' as string]: `${delay}s` }}
          cx={ax + dx * s}
          cy={ay + dy * s}
          r={1.1 * s}
          fill="#fff6d0"
        />
      ))}
    </g>
  )
}

/**
 * Espressione col sole (coordinate del viso): occhi socchiusi beati, due archetti
 * all'ingiù; quello dal lato della luce un po' più stretto. Un sorriso morbido
 * con la bocca appena aperta e un filo di rossore caldo sulle guance.
 */
export function SunFace() {
  return (
    <g className="sun-face">
      <path d="M36.2 51 Q41 56.2 45.8 51" stroke="currentColor" strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <path d="M54.6 50.2 Q59 54.4 63.4 50.2" stroke="currentColor" strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <path d="M44.5 64.5 Q50 70.5 55.5 64.5 Q50 66.6 44.5 64.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <ellipse cx="33.5" cy="60" rx="4.6" ry="2.6" fill="#ffb36b" opacity=".45" />
      <ellipse cx="66.5" cy="60" rx="4.6" ry="2.6" fill="#ffb36b" opacity=".6" />
    </g>
  )
}
