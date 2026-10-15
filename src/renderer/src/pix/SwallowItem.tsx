import { useEffect, useRef } from 'react'
import { SWALLOW_S } from './shapes'

/**
 * Aspetto di ciò che Pix inghiotte, preso dall'oggetto stesso:
 * l'icona di Windows del file (come in Esplora file), le prime parole del
 * testo su un foglietto, oppure il nome del sito per un link.
 */
export type SwallowLook = { icon: string } | { text: string } | { site: string }

/** Prime parole del testo, su al massimo 4 righe brevi. */
function lines(text: string): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const out: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 11) {
      if (line) out.push(line)
      line = w.slice(0, 11)
      if (out.length === 4) break
    } else line = (line + ' ' + w).trim()
  }
  if (line && out.length < 4) out.push(line)
  return out
}

function Look({ look }: { look: SwallowLook }) {
  if ('icon' in look) return <image href={look.icon} x="-16" y="-16" width="32" height="32" />
  if ('site' in look) {
    const label = look.site.length > 16 ? `${look.site.slice(0, 15)}…` : look.site
    const w = Math.max(24, label.length * 3.1 + 8)
    return (
      <g>
        <rect x={-w / 2} y="-6" width={w} height="12" rx="6" fill="var(--surface, #fff)" stroke="rgba(0,0,0,.15)" />
        <text y="2" fontSize="5.4" textAnchor="middle" fill="currentColor" fontFamily="Segoe UI, sans-serif">
          {label}
        </text>
      </g>
    )
  }
  return (
    <g>
      <rect x="-13" y="-15" width="26" height="30" rx="2.5" fill="#fff" stroke="rgba(0,0,0,.15)" />
      <text x="-10" y="-8" fontSize="4.4" fill="#3a3b45" fontFamily="Segoe UI, sans-serif">
        {lines(look.text).map((l, i) => (
          <tspan key={i} x="-10" dy={i === 0 ? 0 : 5.6}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  )
}

interface Props {
  look: SwallowLook
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/**
 * Ciò che hai lasciato cadere viene risucchiato nella bocca di Pix: parte
 * piano, accelera, si allunga nel verso del moto (con una scia), si
 * rimpicciolisce e sparisce in bocca esattamente quando la bocca si chiude.
 */
export function SwallowItem({ look, from, to }: Props) {
  const refs = [useRef<SVGGElement>(null), useRef<SVGGElement>(null), useRef<SVGGElement>(null)]

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const dur = SWALLOW_S.bite * 1000
    // Curva: sale un po' prima di tuffarsi nella bocca.
    const ctrl = { x: (from.x + to.x) / 2 + 6, y: Math.min(from.y, to.y) - 26 }
    const at = (e: number) => {
      const u = 1 - e
      return { x: u * u * from.x + 2 * u * e * ctrl.x + e * e * to.x, y: u * u * from.y + 2 * u * e * ctrl.y + e * e * to.y }
    }
    const place = (el: SVGGElement | null, p: number) => {
      if (!el) return
      const k = Math.min(1, Math.max(0, p))
      // Risucchio: lento all'inizio, poi sempre più veloce.
      const e = k < 0.15 ? 0 : ((k - 0.15) / 0.85) ** 2.2
      const pos = at(e)
      const ahead = at(Math.min(1, e + 0.02))
      const angle = (Math.atan2(ahead.y - pos.y, ahead.x - pos.x) * 180) / Math.PI
      const pop = k < 0.15 ? 0.6 + 0.4 * Math.sin((k / 0.15) * (Math.PI / 2)) : 1
      const size = pop * (1 - 0.88 * e)
      const stretch = 1 + 1.4 * e * (1 - e) * 2
      const wobble = Math.sin(k * 30) * 6 * (1 - e)
      el.setAttribute(
        'transform',
        `translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)}) rotate(${angle.toFixed(1)}) scale(${(size * stretch).toFixed(3)} ${(size / stretch).toFixed(3)}) rotate(${(wobble - angle).toFixed(1)})`
      )
    }
    const step = (now: number) => {
      const p = (now - start) / dur
      place(refs[0]!.current, p)
      place(refs[1]!.current, p - 0.06)
      place(refs[2]!.current, p - 0.12)
      if (p < 1) raf = requestAnimationFrame(step)
      else for (const r of refs) r.current?.setAttribute('opacity', '0')
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from.x, from.y, to.x, to.y])

  return (
    <g pointerEvents="none" aria-hidden="true">
      {/* Scia: due copie sbiadite un attimo indietro, come un mosso */}
      <g ref={refs[2]} opacity="0.18">
        <Look look={look} />
      </g>
      <g ref={refs[1]} opacity="0.35">
        <Look look={look} />
      </g>
      <g ref={refs[0]} style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.25))' }}>
        <Look look={look} />
      </g>
    </g>
  )
}
