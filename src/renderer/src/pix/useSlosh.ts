import { useEffect, type RefObject } from 'react'
import { PIX_ANCHOR } from './geometry'

/** Inclinazione massima (gradi di "taglio") mentre scorri. */
const MAX_TILT = 12
/** Molla: rigidità e smorzamento (poco smorzata = oscilla un paio di volte). */
const STIFF = 90
const DAMP = 7

/**
 * Pix come un liquido in un bicchiere: mentre scorri una lista del pannello
 * il corpo si inclina nel verso dello scorrimento (la base resta ferma) e,
 * quando ti fermi, oscilla e torna dritto. Il ciclo di animazione gira solo
 * mentre si muove.
 */
export function useSlosh(ref: RefObject<SVGGElement | null>, active: boolean, scale: number): void {
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    let raf = 0
    let last = 0
    let angle = 0
    let vel = 0
    let push = 0
    const tops = new WeakMap<EventTarget, number>()

    const step = (now: number) => {
      const dt = last ? Math.min(0.033, (now - last) / 1000) : 1 / 60
      last = now
      // La spinta dello scorrimento si spegne in fretta: poi resta solo la molla.
      push *= Math.exp(-dt * 10)
      const target = Math.max(-MAX_TILT, Math.min(MAX_TILT, push))
      vel += ((target - angle) * STIFF - vel * DAMP) * dt
      angle += vel * dt
      const x = PIX_ANCHOR.x
      const y = PIX_ANCHOR.y
      el.setAttribute('transform', `translate(${x} ${y}) skewX(${angle.toFixed(2)}) translate(${-x} ${-y})`)
      if (Math.abs(angle) < 0.05 && Math.abs(vel) < 0.05 && Math.abs(push) < 0.05) {
        el.removeAttribute('transform')
        raf = 0
        last = 0
        return
      }
      raf = requestAnimationFrame(step)
    }

    const onScroll = (e: Event) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const prev = tops.get(t)
      tops.set(t, t.scrollTop)
      if (prev === undefined) return
      const dy = t.scrollTop - prev
      // Scorrendo in giù il liquido "resta indietro" e si inclina all'insù (e viceversa).
      push = Math.max(-MAX_TILT * 1.5, Math.min(MAX_TILT * 1.5, push - dy * 0.22 * scale))
      if (!raf) raf = requestAnimationFrame(step)
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      if (raf) cancelAnimationFrame(raf)
      el.removeAttribute('transform')
    }
  }, [active, scale])
}
