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
  const necksRef = useRef<Array<SVGLineElement | null>>([])
  const dropsRef = useRef<SVGGElement>(null)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const b = restBody(scale, shape)
    const bottom = b.cy + b.h / 2
    const R = 0.055 * b.w
    const falling: Falling[] = []
    const lastCycle = MELT_DRIPS.map(() => -1)
    /** Dove si trovava la pallina appena prima di staccarsi (la goccia parte da lì). */
    const bulbAt: Array<{ x: number; y: number; r: number } | null> = MELT_DRIPS.map(() => null)

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
        const { n, k, growing } = dripCycle(d, t)
        const el = bulbsRef.current[i]
        const neck = necksRef.current[i]
        // Una sola goccia per colata: dopo il distacco non se ne forma un'altra.
        if (growing && n === 0 && t < 3.5) {
          // La pallina si gonfia in punta alla colata, insieme a lei; poco prima di staccarsi
          // scende e resta appesa a un collo sempre più sottile, che alla fine si rompe.
          const r = R * Math.min(1, L / d.len) * a
          const pull = Math.min(1, Math.max(0, (k - 0.6) / 0.2))
          const sag = pull * pull * (3 - 2 * pull)
          const cy = tip - r * 0.45 + sag * r * 1.6
          el?.setAttribute('cx', x.toFixed(2))
          el?.setAttribute('cy', cy.toFixed(2))
          el?.setAttribute('r', Math.max(0, r).toFixed(2))
          if (neck) {
            neck.setAttribute('x1', x.toFixed(2))
            neck.setAttribute('x2', x.toFixed(2))
            neck.setAttribute('y1', (tip - r * 0.3).toFixed(2))
            neck.setAttribute('y2', cy.toFixed(2))
            neck.setAttribute('stroke-width', (sag > 0 ? r * 0.9 * (1 - sag) + 0.4 : 0).toFixed(2))
          }
          bulbAt[i] = { x, y: cy, r }
        } else {
          el?.setAttribute('r', '0')
          neck?.setAttribute('stroke-width', '0')
          // Appena staccata: la stessa pallina diventa una goccia che cade.
          const from = bulbAt[i]
          if (n === 0 && lastCycle[i]! < 0 && t < 3.7 && t > 0.7 && from) {
            lastCycle[i] = n
            falling.push({ x: from.x, y: from.y + from.r, vy: 40, r: from.r, floor: bottom + d.len * b.h + 26 * scale, splash: 0 })
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
        <line key={`n${i}`} ref={(el) => void (necksRef.current[i] = el)} stroke={color} strokeLinecap="round" strokeWidth="0" />
      ))}
      {MELT_DRIPS.map((_, i) => (
        <circle key={i} ref={(el) => void (bulbsRef.current[i] = el)} r="0" />
      ))}
      <g ref={dropsRef} />
    </g>
  )
}
