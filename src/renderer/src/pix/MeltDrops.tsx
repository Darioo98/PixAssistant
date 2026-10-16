import { useEffect, useRef } from 'react'
import type { PixShape } from '@shared/mascot'
import { MELT_DRIPS, dripCycle, dripLength, liveShape, restBody } from './shapes'

interface Props {
  /** Istante (performance.now) in cui è partita l'animazione "Si scioglie". */
  start: number
  scale: number
  shape: PixShape
  color: string
}

/** Ampiezza dell'animazione del corpo (come in morph.ts: entrata 0.6 s, tenuta, uscita 0.7 s). */
function amplitude(t: number): number {
  if (t < 0.6) {
    const x = t / 0.6
    const c = 1.9
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
  }
  if (t < 3.5) return 1
  const x = Math.min(1, (t - 3.5) / 0.7)
  return 1 - (1 - (1 - x) ** 3)
}

interface Falling {
  x: number
  y: number
  vy: number
  r: number
  floor: number
  splash: number
}

const GRAVITY = 520
const SPLASH_S = 0.18

/**
 * "Si scioglie": in punta a ogni colata si forma una pallina che si gonfia;
 * quando la colata la lascia andare diventa una goccia che cade (con la
 * gravità, allungandosi un poco) e si spiaccica. Tutto con lo stesso tempo del corpo.
 */
export function MeltDrops({ start, scale, shape, color }: Props) {
  const bulbsRef = useRef<Array<SVGCircleElement | null>>([])
  const dropsRef = useRef<SVGGElement>(null)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const b = restBody(scale, shape)
    const bottom = b.cy + b.h / 2
    const R = 0.055 * b.w
    const falling: Falling[] = []
    const lastCycle = MELT_DRIPS.map(() => -1)

    const step = (now: number) => {
      const t = (now - start) / 1000
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      const a = Math.max(0, amplitude(t))
      // La punta vera di ogni colata, presa dalla forma del corpo in questo istante.
      const pts = liveShape(b, 'melt', t, a)
      MELT_DRIPS.forEach((d, i) => {
        const L = dripLength(d, t) * a
        let tipX = b.cx + d.u * (b.w / 2)
        let tip = bottom
        pts.forEach(([px, py], j) => {
          if (Math.abs(b.u[j]! - d.u) < 0.08 && b.ny[j]! > 0 && py > tip) {
            tip = py
            tipX = px
          }
        })
        const x = tipX
        const { n, growing } = dripCycle(d, t)
        const el = bulbsRef.current[i]
        if (growing && t < 3.5) {
          // La pallina si gonfia in punta alla colata, insieme a lei.
          const r = R * Math.min(1, L / d.len) * a
          el?.setAttribute('cx', x.toFixed(2))
          el?.setAttribute('cy', (tip - r * 0.45).toFixed(2))
          el?.setAttribute('r', Math.max(0, r).toFixed(2))
        } else {
          el?.setAttribute('r', '0')
          // Appena staccata: diventa una goccia che cade.
          if (n !== lastCycle[i] && t < 3.7 && t > 0.7) {
            lastCycle[i] = n
            falling.push({ x, y: tip, vy: 30, r: R * a, floor: bottom + d.len * b.h + 26 * scale, splash: 0 })
          }
        }
      })

      // Gocce che cadono e si spiaccicano.
      const g = dropsRef.current
      if (g) {
        let html = ''
        for (let j = falling.length - 1; j >= 0; j--) {
          const f = falling[j]!
          if (f.splash > 0) {
            f.splash += dt
            if (f.splash > SPLASH_S) {
              falling.splice(j, 1)
              continue
            }
          } else {
            f.vy += GRAVITY * dt
            f.y += f.vy * dt
            if (f.y >= f.floor) {
              f.y = f.floor
              f.splash = 0.0001
            }
          }
          const k = f.splash / SPLASH_S
          const sy = f.splash ? 1 - 0.85 * k : 1 + Math.min(0.4, f.vy * 0.0016)
          const sx = f.splash ? 1 + 1.4 * k : 1 / Math.sqrt(sy)
          const op = f.splash ? 1 - k : 1
          const r = f.r
          // Goccia: tonda sotto, appena appuntita sopra.
          html += `<path d="M0 ${(-r * 1.35).toFixed(2)} C${(r * 0.55).toFixed(2)} ${(-r * 0.75).toFixed(2)} ${r.toFixed(2)} ${(-r * 0.3).toFixed(2)} ${r.toFixed(2)} 0 A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(-r).toFixed(2)} 0 C${(-r).toFixed(2)} ${(-r * 0.3).toFixed(2)} ${(-r * 0.55).toFixed(2)} ${(-r * 0.75).toFixed(2)} 0 ${(-r * 1.35).toFixed(2)} Z" transform="translate(${f.x.toFixed(2)} ${f.y.toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})" opacity="${op.toFixed(2)}"/>`
        }
        g.innerHTML = html
      }
      if (t < 4.2 || falling.length) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [start, scale, shape])

  return (
    <g fill={color} pointerEvents="none" aria-hidden="true">
      {MELT_DRIPS.map((_, i) => (
        <circle key={i} ref={(el) => void (bulbsRef.current[i] = el)} r="0" />
      ))}
      <g ref={dropsRef} />
    </g>
  )
}
