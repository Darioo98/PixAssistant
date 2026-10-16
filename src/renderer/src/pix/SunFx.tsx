import { useEffect, useRef, type RefObject } from 'react'
import type { SunStyle } from '@shared/settings'
import { PIX_ANCHOR } from './geometry'

/**
 * Sole, in quattro versioni da provare (Impostazioni → Aspetto):
 * A "bask"   Pix prende il sole: si allunga verso la luce, occhi beati, guance rosa, un riflesso dorato che gli scorre addosso.
 * B "shades" Solo occhiali: due gocce del suo fluido scendono dalla testa e diventano lenti scure.
 * C "beam"   Luce morbida da destra che accarezza Pix (bordo dorato), con gli occhiali.
 * D "sun"    Pix diventa il sole: disco con fiammelle morbide, dorato, con un alone caldo.
 */

/** Copia del contorno del corpo, aggiornata a ogni fotogramma (per velature e aloni). */
export function BodyTint({ source, className, fill, filter }: { source: RefObject<SVGPathElement | null>; className: string; fill: string; filter?: string }) {
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
  return <path ref={ref} className={className} fill={fill} filter={filter} pointerEvents="none" />
}

/** Definizioni condivise (sfumature e sfocature) per le velature del sole. */
export function SunDefs({ id, scale: s }: { id: string; scale: number }) {
  return (
    <defs>
      {/* A: riflesso dorato che scorre sul corpo */}
      <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0.35">
        <stop offset="0" stopColor="#ffe08a" stopOpacity="0" />
        <stop offset="0.42" stopColor="#ffe08a" stopOpacity="0" />
        <stop offset="0.5" stopColor="#fff2c2" stopOpacity="0.75" />
        <stop offset="0.58" stopColor="#ffe08a" stopOpacity="0" />
        <stop offset="1" stopColor="#ffe08a" stopOpacity="0" />
        <animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="2.1s" repeatCount="indefinite" />
      </linearGradient>
      {/* C: bordo illuminato dalla luce che arriva da destra */}
      <linearGradient id={`${id}-rim`} x1="1" y1="0.1" x2="0.35" y2="0.75">
        <stop offset="0" stopColor="#ffd25e" stopOpacity="0.85" />
        <stop offset="0.45" stopColor="#ffd25e" stopOpacity="0.25" />
        <stop offset="1" stopColor="#ffd25e" stopOpacity="0" />
      </linearGradient>
      {/* D: il corpo diventa oro caldo */}
      <radialGradient id={`${id}-gold`} cx="0.42" cy="0.38" r="0.7">
        <stop offset="0" stopColor="#ffe680" />
        <stop offset="0.65" stopColor="#ffc23d" />
        <stop offset="1" stopColor="#ff9f1c" />
      </radialGradient>
      <filter id={`${id}-halo`} x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation={7 * s} />
      </filter>
      <filter id={`${id}-light`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={9 * s} />
      </filter>
    </defs>
  )
}

/** C: un fascio di luce largo e sfocato da destra, senza bordi visibili, e qualche pulviscolo. */
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
    <g className="sky-sun sun-c" pointerEvents="none">
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
 * B (e C): occhiali fatti del fluido di Pix. Due gocce del suo colore si staccano
 * dalla testa, scivolano giù sugli occhi, si schiacciano in lenti e diventano scure;
 * alla fine risalgono e rientrano nella testa. Coordinate del viso (100×100).
 */
export function FluidShades({ id, color }: { id: string; color: string }) {
  return (
    <g className="fluid-shades" pointerEvents="none">
      <defs>
        <linearGradient id={`${id}-lens2`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#3a3b5c" />
          <stop offset="1" stopColor="#14152a" />
        </linearGradient>
      </defs>
      <path className="fs-bridge" d="M47 49q3-3 6 0" stroke="#14152a" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      {[23, 52].map((x) => (
        <g key={x} className="fs-lens">
          {/* la goccia del colore di Pix, che poi si scurisce */}
          <rect x={x} y="42" width="25" height="20" rx="10" fill={color} stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" />
          <rect className="fs-dark" x={x} y="42" width="25" height="20" rx="10" fill={`url(#${id}-lens2)`} />
          <path className="fs-glint" d={`M${x + 5} 48q3-3.5 8-3.5`} stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        </g>
      ))}
    </g>
  )
}

/** A: guance rosate (coordinate del viso). */
export function Blush() {
  return (
    <g className="sun-blush" pointerEvents="none">
      <ellipse cx="33" cy="61" rx="5" ry="3" fill="#ff8fa3" />
      <ellipse cx="67" cy="61" rx="5" ry="3" fill="#ff8fa3" />
    </g>
  )
}

/** Quali pezzi usa ogni versione. */
export const SUN_PARTS: Record<SunStyle, { body: boolean; bliss: boolean; shades: boolean; light: boolean }> = {
  bask: { body: true, bliss: true, shades: false, light: false },
  shades: { body: false, bliss: false, shades: true, light: false },
  beam: { body: false, bliss: false, shades: true, light: true },
  sun: { body: true, bliss: true, shades: false, light: false }
}
