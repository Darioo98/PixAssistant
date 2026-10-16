import { PIX_ANCHOR } from './geometry'

interface Props {
  id: string
  scale: number
  hot: boolean
}

type P = { x: number; y: number }

/** Raggio affusolato da `o` a `t`: sottile all'origine, più largo e arrotondato in fondo. */
function ray(o: P, t: P, w0: number, w1: number): string {
  const dx = t.x - o.x
  const dy = t.y - o.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const ux = dx / len
  const uy = dy / len
  const f = (n: number) => n.toFixed(2)
  return (
    `M${f(o.x + nx * w0)} ${f(o.y + ny * w0)} L${f(t.x + nx * w1)} ${f(t.y + ny * w1)} ` +
    `Q${f(t.x + ux * w1 * 1.4)} ${f(t.y + uy * w1 * 1.4)} ${f(t.x - nx * w1)} ${f(t.y - ny * w1)} ` +
    `L${f(o.x - nx * w0)} ${f(o.y - ny * w0)} Z`
  )
}

/**
 * Raggio di sole che entra da destra (dal bordo dello schermo): tre raggi
 * sottili a ventaglio con i bordi sfumati, un alone morbido dove la luce tocca
 * Pix e qualche granello di luce che brilla. Arancione quando fa caldo.
 */
export function SunBeam({ id, scale: s, hot }: Props) {
  const color = hot ? '#ffa04d' : '#ffd95a'
  const o = { x: PIX_ANCHOR.x + 52 * s, y: PIX_ANCHOR.y - 128 * s }
  const head = { x: PIX_ANCHOR.x + 2 * s, y: PIX_ANCHOR.y - 56 * s }
  const rays = [
    { t: { x: PIX_ANCHOR.x - 16 * s, y: PIX_ANCHOR.y - 50 * s }, w: 6 * s, o: 0.55 },
    { t: { x: PIX_ANCHOR.x + 4 * s, y: PIX_ANCHOR.y - 44 * s }, w: 9 * s, o: 0.75 },
    { t: { x: PIX_ANCHOR.x + 22 * s, y: PIX_ANCHOR.y - 56 * s }, w: 5 * s, o: 0.5 }
  ]
  const motes = [0.35, 0.55, 0.72, 0.48].map((k, i) => {
    const t = rays[i % rays.length]!.t
    return { x: o.x + (t.x - o.x) * k + (i % 2 ? 3 : -3) * s, y: o.y + (t.y - o.y) * k, d: i * 0.45 }
  })
  return (
    <g className="sky-sun" pointerEvents="none">
      <defs>
        <linearGradient id={`${id}-beam`} gradientUnits="userSpaceOnUse" x1={o.x} y1={o.y} x2={head.x} y2={head.y}>
          <stop offset="0" stopColor={color} stopOpacity="0.85" />
          <stop offset="0.7" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor={color} stopOpacity="0.55" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={1.6 * s} />
        </filter>
      </defs>
      <g className="sun-beam" filter={`url(#${id}-soft)`}>
        {rays.map((r, i) => (
          <path key={i} d={ray(o, r.t, 1.2 * s, r.w)} fill={`url(#${id}-beam)`} opacity={r.o} />
        ))}
      </g>
      {/* Alone dove la luce tocca la testa */}
      <ellipse className="sun-glow" cx={head.x} cy={head.y} rx={20 * s} ry={11 * s} fill={`url(#${id}-glow)`} />
      {/* Granelli di luce nel raggio */}
      {motes.map((m, i) => (
        <path
          key={i}
          className="sun-mote"
          style={{ ['--mote-delay' as string]: `${m.d}s` }}
          d={`M${m.x} ${m.y - 2.4 * s}l${0.7 * s} ${1.7 * s} ${1.7 * s} ${0.7 * s} ${-1.7 * s} ${0.7 * s} ${-0.7 * s} ${1.7 * s} ${-0.7 * s} ${-1.7 * s} ${-1.7 * s} ${-0.7 * s} ${1.7 * s} ${-0.7 * s}z`}
          fill="#fff"
        />
      ))}
    </g>
  )
}
