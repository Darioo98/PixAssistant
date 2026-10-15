import { lighten, type Mood, type PixEyes, type PixFinish, type PixTransform } from '@shared/mascot'

/**
 * Occhi ed espressioni di Pix, nelle coordinate delle bozze (viewBox 100×100,
 * corpo x 20–80, y 22–88). Gli occhi sono l'espressione principale; il colore
 * arriva da `currentColor` (bianco, o scuro sui corpi chiari).
 */
export function Eyes({ mood, style = 'pill' }: { mood: Mood; style?: PixEyes }) {
  switch (mood) {
    case 'alert':
      return (
        <>
          <circle cx="41" cy="52" r="5.6" fill="currentColor" />
          <circle cx="59" cy="52" r="5.6" fill="currentColor" />
          <circle cx="50" cy="68" r="3" fill="currentColor" />
        </>
      )
    case 'happy':
    case 'greet':
      return (
        <>
          <path d="M36.5 54 Q41 41.2 45.5 54" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M54.5 54 Q59 41.2 63.5 54" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
          {mood === 'happy' && <path d="M44 66q6 6 12 0" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />}
        </>
      )
    case 'sleep':
      return (
        <>
          <path d="M36.5 52 h9" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
          <path d="M54.5 52 h9" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
        </>
      )
    default:
      if (style === 'dot')
        return (
          <>
            <circle cx="41" cy="52" r="4.2" fill="currentColor" />
            <circle cx="59" cy="52" r="4.2" fill="currentColor" />
          </>
        )
      if (style === 'wide')
        return (
          <>
            <rect x="37.6" y="44.5" width="6.8" height="15" rx="3.4" fill="currentColor" />
            <rect x="55.6" y="44.5" width="6.8" height="15" rx="3.4" fill="currentColor" />
          </>
        )
      return (
        <>
          <rect x="38.3" y="46" width="5.4" height="12" rx="2.7" fill="currentColor" />
          <rect x="56.3" y="46" width="5.4" height="12" rx="2.7" fill="currentColor" />
        </>
      )
  }
}

/** Riflesso bianco semitrasparente in alto a sinistra. */
export function Shine() {
  return <path d="M30 34q4-8 14-9" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".35" fill="none" />
}

/**
 * Riempimento del corpo: piatto o con una leggera sfumatura verso l'alto.
 * Gli stop cambiano colore con una transizione CSS (vedi .pix-stop).
 */
export function PixFill({ id, color, finish }: { id: string; color: string; finish: PixFinish }) {
  const top = finish === 'gradient' ? lighten(color, 0.28) : color
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0.35" y2="1">
        <stop className="pix-stop" offset="0" style={{ stopColor: top }} />
        <stop className="pix-stop" offset="1" style={{ stopColor: color }} />
      </linearGradient>
    </defs>
  )
}

/** Badge accanto alla testa: "!" (avviso), "z z" (dorme), coriandoli (felice), puntini (pensa). */
export function Badge({ mood }: { mood: Mood }) {
  switch (mood) {
    case 'alert':
      return (
        <g className="badge badge-alert">
          <circle cx="86" cy="14" r="9" fill="#F04452" />
          <path d="M86 9.5v4.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="86" cy="18.3" r="1.5" fill="#fff" />
        </g>
      )
    case 'sleep':
      return (
        <g className="badge badge-sleep" fill="#8A93B5" fontFamily="Segoe UI, sans-serif" fontWeight="600">
          <text className="z z1" x="80" y="18" fontSize="12">
            z
          </text>
          <text className="z z2" x="88" y="9" fontSize="9">
            z
          </text>
        </g>
      )
    case 'happy':
      return (
        <g className="badge badge-happy">
          <circle className="confetti c1" cx="80" cy="16" r="2.2" fill="#FFB547" />
          <circle className="confetti c2" cx="90" cy="8" r="1.8" fill="#4FD1C5" />
          <circle className="confetti c3" cx="92" cy="19" r="1.6" fill="#F06BA8" />
          <circle className="confetti c4" cx="16" cy="14" r="1.8" fill="#8B8EF7" />
          <circle className="confetti c5" cx="8" cy="24" r="1.5" fill="#FFB547" />
          <circle className="confetti c6" cx="24" cy="6" r="1.4" fill="#4FD1C5" />
        </g>
      )
    case 'think':
      return (
        <g className="badge badge-think" fill="#8A93B5">
          <circle className="dot d1" cx="40" cy="12" r="2.6" />
          <circle className="dot d2" cx="50" cy="8" r="2.6" />
          <circle className="dot d3" cx="60" cy="12" r="2.6" />
        </g>
      )
    default:
      return null
  }
}

/**
 * Appendici del fluido (coordinate delle bozze, sommità del corpo a y ≈ 22).
 * Stanno DIETRO al corpo: la base resta nascosta e sembrano crescere da Pix.
 * `fill` è lo stesso riempimento del corpo (colore e finitura).
 */
export function Appendage({ kind, fill, state }: { kind: PixTransform; fill: string; state: 'in' | 'out' | 'still' }) {
  const cls = `acc acc-${kind} ${state === 'in' ? 'sprout' : state === 'out' ? 'retract' : ''}`
  switch (kind) {
    case 'horns':
      return (
        <g className={cls}>
          <path className="acc-part left" d="M31 31 C26 23 23.5 14 26 5.5 C31 13 36.5 19 42 25 Z" fill={fill} />
          <path className="acc-part right" d="M69 31 C74 23 76.5 14 74 5.5 C69 13 63.5 19 58 25 Z" fill={fill} />
        </g>
      )
    case 'ears':
      return (
        <g className={cls}>
          <path className="acc-part left" d="M24 34 L28.5 9 L46 25 Z" fill={fill} strokeLinejoin="round" />
          <path className="acc-part right" d="M76 34 L71.5 9 L54 25 Z" fill={fill} strokeLinejoin="round" />
          <path d="M30 27 L31 16 L39.5 24 Z" fill="#fff" opacity=".28" />
          <path d="M70 27 L69 16 L60.5 24 Z" fill="#fff" opacity=".28" />
        </g>
      )
    case 'antennae':
      return (
        <g className={cls}>
          <g className="acc-part left">
            <path d="M41 26 Q38 16 33 9" stroke={fill} strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <circle cx="33" cy="8" r="3.6" fill={fill} />
            <circle cx="32" cy="7" r="1.1" fill="#fff" opacity=".6" />
          </g>
          <g className="acc-part right">
            <path d="M59 26 Q62 16 67 9" stroke={fill} strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <circle cx="67" cy="8" r="3.6" fill={fill} />
            <circle cx="66" cy="7" r="1.1" fill="#fff" opacity=".6" />
          </g>
        </g>
      )
    case 'tuft':
      return (
        <g className={cls}>
          <path className="acc-part" d="M44 27 C40 17 46 7 57 7.5 C51 11 49.5 15 51 19 C53 14 58 12 62 14 C56 16 54 21 54 27 Z" fill={fill} />
        </g>
      )
    case 'leaf':
      return (
        <g className={cls}>
          <g className="acc-part">
            <path d="M50 26 L50 13" stroke="#3FAE5C" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M50 14 C53 6 62 4 67 7 C62 13 56 15 50 14 Z" fill="#4ADE80" />
            <path d="M50 17 C47 11 40 10 36 12 C40 17 45 18 50 17 Z" fill="#22C55E" />
          </g>
        </g>
      )
    case 'drips':
      return (
        <g className={cls}>
          <path className="acc-part drip d1" d="M30 80 C30 90 31.5 95 34 95 C36.5 95 38 90 38 80 Z" fill={fill} />
          <path className="acc-part drip d2" d="M50 84 C50 95 51.5 101 53.5 101 C55.5 101 57 95 57 84 Z" fill={fill} />
          <path className="acc-part drip d3" d="M64 82 C64 89 65 92 67 92 C69 92 70 89 70 82 Z" fill={fill} />
        </g>
      )
  }
}
