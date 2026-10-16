import { useEffect, useRef } from 'react'

/** Molla della superficie: poco smorzata, così dopo lo scorrimento ondeggia un paio di volte. */
const STIFF = 70
const DAMP = 5.5

/**
 * Pix come un liquido in un bicchiere: mentre scorri una lista del pannello
 * la superficie si inclina e resta indietro rispetto al movimento; quando ti
 * fermi ondeggia e si calma. `onFrame` riceve l'inclinazione (-1…1) e il tempo;
 * con 0 il corpo torna a riposo. Il ciclo gira solo mentre si muove.
 */
export function useSlosh(active: boolean, onFrame: (a: number, t: number) => void): void {
  const cb = useRef(onFrame)
  cb.current = onFrame

  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = 0
    let a = 0
    let vel = 0
    let push = 0
    const tops = new WeakMap<EventTarget, number>()

    const step = (now: number) => {
      const dt = last ? Math.min(0.033, (now - last) / 1000) : 1 / 60
      last = now
      // La spinta dello scorrimento si spegne in fretta: poi resta solo la molla.
      push *= Math.exp(-dt * 9)
      const target = Math.max(-1, Math.min(1, push))
      vel += ((target - a) * STIFF - vel * DAMP) * dt
      a += vel * dt
      if (Math.abs(a) < 0.004 && Math.abs(vel) < 0.01 && Math.abs(push) < 0.01) {
        cb.current(0, now / 1000)
        raf = 0
        last = 0
        return
      }
      cb.current(Math.max(-1.2, Math.min(1.2, a)), now / 1000)
      raf = requestAnimationFrame(step)
    }

    const onScroll = (e: Event) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const prev = tops.get(t)
      tops.set(t, t.scrollTop)
      if (prev === undefined) return
      // Scorrendo in giù il liquido "resta indietro" (e viceversa).
      push = Math.max(-1.4, Math.min(1.4, push - (t.scrollTop - prev) * 0.018))
      if (!raf) raf = requestAnimationFrame(step)
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      if (raf) cancelAnimationFrame(raf)
      cb.current(0, 0)
    }
  }, [active])
}
