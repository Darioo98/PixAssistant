import { useEffect, useRef } from 'react'
import { SWALLOW_S } from './shapes'

export type SwallowKind = 'pdf' | 'word' | 'image' | 'text' | 'file' | 'folder' | 'link' | 'note'

/** Riconosce il tipo di ciò che è stato trascinato, per disegnarne l'icona. */
export function swallowKindOf(names: string[], text: string): SwallowKind {
  if (names.length === 0) return /^\s*(https?:\/\/|www\.)\S+\s*$/i.test(text) ? 'link' : 'note'
  const name = names[0]!.toLowerCase()
  const ext = /\.([a-z0-9]+)$/.exec(name)?.[1]
  if (!ext) return 'folder'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'doc' || ext === 'docx' || ext === 'odt' || ext === 'rtf') return 'word'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return 'image'
  if (['txt', 'md', 'csv', 'json', 'log', 'xml', 'html', 'ini', 'yaml', 'yml'].includes(ext)) return 'text'
  return 'file'
}

/** Icona disegnata attorno all'origine, circa 22×28. */
function Icon({ kind }: { kind: SwallowKind }) {
  if (kind === 'folder') {
    return (
      <g>
        <path d="M-12 -8 a2 2 0 0 1 2 -2 h7 l3 3 h10 a2 2 0 0 1 2 2 v14 a2 2 0 0 1 -2 2 h-20 a2 2 0 0 1 -2 -2 z" fill="#f2b84b" />
        <path d="M-12 -3 h24 v12 a2 2 0 0 1 -2 2 h-20 a2 2 0 0 1 -2 -2 z" fill="#f7cd6b" />
      </g>
    )
  }
  if (kind === 'link') {
    return (
      <g fill="none" stroke="#3b82f6" strokeWidth="2">
        <circle r="11" fill="#fff" />
        <ellipse rx="5" ry="11" />
        <path d="M-11 0 h22 M-9 -6 h18 M-9 6 h18" strokeWidth="1.4" />
      </g>
    )
  }
  const band: Partial<Record<SwallowKind, [string, string]>> = { pdf: ['#e5484d', 'PDF'], word: ['#2b6cd8', 'W'] }
  const b = band[kind]
  return (
    <g>
      <path d="M-9 -14 h12 l7 7 v19 a2 2 0 0 1 -2 2 h-17 a2 2 0 0 1 -2 -2 v-24 a2 2 0 0 1 2 -2 z" fill="#fff" stroke="#cfd2dc" strokeWidth="1" />
      <path d="M3 -14 v7 h7" fill="#eceef3" stroke="#cfd2dc" strokeWidth="1" />
      {kind === 'image' ? (
        <g>
          <rect x="-8" y="-4" width="15" height="11" rx="1.5" fill="#d9f2e4" />
          <path d="M-8 6 l5 -6 l4 4 l3 -3 l3 5 z" fill="#2fa36b" />
          <circle cx="3" cy="-1" r="1.6" fill="#f2b84b" />
        </g>
      ) : (
        <g stroke={kind === 'note' ? '#f2b84b' : '#c3c7d3'} strokeWidth="1.6" strokeLinecap="round">
          <path d="M-6 -3 h11 M-6 1 h11 M-6 5 h8 M-6 9 h10" />
        </g>
      )}
      {b && (
        <g>
          <rect x="-12" y="-9" width={b[1].length > 1 ? 15 : 10} height="8" rx="1.5" fill={b[0]} />
          <text x={b[1].length > 1 ? -4.5 : -7} y="-2.7" fontSize="5.6" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Segoe UI, sans-serif">
            {b[1]}
          </text>
        </g>
      )}
    </g>
  )
}

interface Props {
  kind: SwallowKind
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/**
 * Ciò che hai lasciato cadere viene risucchiato nella bocca di Pix: parte
 * piano, accelera, si allunga nel verso del moto (con una scia), si
 * rimpicciolisce e sparisce in bocca esattamente quando la bocca si chiude.
 */
export function SwallowItem({ kind, from, to }: Props) {
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
        <Icon kind={kind} />
      </g>
      <g ref={refs[1]} opacity="0.35">
        <Icon kind={kind} />
      </g>
      <g ref={refs[0]} style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.25))' }}>
        <Icon kind={kind} />
      </g>
    </g>
  )
}
