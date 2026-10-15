import { useEffect, useRef } from 'react'

/** Evento lanciato quando elimini qualcosa: dettaglio = punto dello schermo (clientX/Y). */
export const DELETED_EVENT = 'pix:deleted'

/** Segnala a Pix un'eliminazione avvenuta in quel punto dello schermo. */
export function notifyDeleted(el: Element | null): void {
  const r = el?.getBoundingClientRect()
  window.dispatchEvent(new CustomEvent(DELETED_EVENT, { detail: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null }))
}

export const SWEEP_MS = 900

interface Props {
  from: { x: number; y: number }
  /** Dove si trova Pix (coordinate dell'SVG): la goccia gli passa accanto e viene spazzata via. */
  pix: { x: number; y: number }
  color: string
}

/**
 * Eliminazione: dalla riga si stacca una goccia, Pix le dà un colpetto e
 * la spazza via in alto; la goccia si allunga, vola via e si sparpaglia in
 * goccioline che svaniscono.
 */
export function SweepDrop({ from, pix, color }: Props) {
  const dropRef = useRef<SVGPathElement>(null)
  const bitsRef = useRef<SVGGElement>(null)

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    // Si alza dalla riga verso Pix, poi viene lanciata in alto a sinistra.
    const hit = { x: pix.x - 14, y: pix.y - 30 }
    const away = { x: from.x - 60, y: Math.min(from.y, hit.y) - 120 }
    const step = (now: number) => {
      const t = (now - start) / SWEEP_MS
      const drop = dropRef.current
      const bits = bitsRef.current
      if (!drop || !bits) return
      if (t >= 1) {
        drop.setAttribute('opacity', '0')
        bits.setAttribute('opacity', '0')
        return
      }
      if (t < 0.45) {
        // Nasce e scivola verso Pix (accelera).
        const k = t / 0.45
        const e = k * k
        const x = from.x + (hit.x - from.x) * e
        const y = from.y + (hit.y - from.y) * e - Math.sin(Math.PI * k) * 18
        const s = Math.min(1, k * 4)
        const angle = (Math.atan2(hit.y - from.y, hit.x - from.x) * 180) / Math.PI
        drop.setAttribute('transform', `translate(${x} ${y}) rotate(${angle}) scale(${s * (1 + 0.5 * e)} ${s / (1 + 0.5 * e)})`)
        drop.setAttribute('opacity', '1')
      } else if (t < 0.8) {
        // Colpo: vola via in alto, allungata nel verso del moto, e rimpicciolisce.
        const k = (t - 0.45) / 0.35
        const e = 1 - (1 - k) ** 2
        const x = hit.x + (away.x - hit.x) * e
        const y = hit.y + (away.y - hit.y) * e
        const angle = (Math.atan2(away.y - hit.y, away.x - hit.x) * 180) / Math.PI
        drop.setAttribute('transform', `translate(${x} ${y}) rotate(${angle}) scale(${(1.6 - k) * (1 - 0.5 * k)} ${0.7 * (1 - 0.5 * k)})`)
      } else {
        // Si sparpaglia in goccioline.
        const k = (t - 0.8) / 0.2
        drop.setAttribute('opacity', '0')
        bits.setAttribute('opacity', String(1 - k))
        bits.setAttribute('transform', `translate(${away.x} ${away.y}) scale(${0.6 + k * 1.4})`)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from.x, from.y, pix.x, pix.y])

  return (
    <g pointerEvents="none" aria-hidden="true">
      <path ref={dropRef} d="M-6 0 C-6 -4 -2 -6 0 -6 C5 -6 9 -2 10 0 C9 2 5 6 0 6 C-2 6 -6 4 -6 0 Z" fill={color} opacity="0" />
      <g ref={bitsRef} opacity="0" fill={color}>
        <circle cx="-6" cy="-3" r="2" />
        <circle cx="5" cy="-6" r="1.6" />
        <circle cx="7" cy="4" r="1.8" />
        <circle cx="-3" cy="6" r="1.3" />
        <circle cx="0" cy="-9" r="1.1" />
      </g>
    </g>
  )
}
