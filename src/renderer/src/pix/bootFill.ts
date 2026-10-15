import { BAR } from './peekMotion'

/** Durata del riempimento della barra all'avvio di Windows. */
export const BOOT_FILL_S = 1.7

const r = (n: number) => Math.round(n * 100) / 100

/**
 * Barra che si riempie dal basso come un tubo: `fill` 0–1 è il livello, `t`
 * i secondi dall'inizio (la superficie del liquido ondeggia e si calma
 * quando il tubo è pieno).
 */
export function bootBarPath(fill: number, t: number): string {
  const rad = (BAR.right - BAR.left) / 2
  const mid = BAR.left + rad
  const k = rad * 0.5523
  const height = (BAR.bottom - BAR.top) * Math.min(1, Math.max(0, fill))
  const top = BAR.bottom - height
  if (height < 2) return ''
  // Superficie del liquido: menisco che ondeggia, smorzato verso la fine.
  const calm = fill >= 1 ? Math.exp(-(t - BOOT_FILL_S) * 6) : 1
  const wave = 2.6 * Math.sin(t * 16) * calm * Math.min(1, height / 12)
  // Da pieno, la cima diventa la normale estremità arrotondata.
  const round = fill >= 1 ? Math.min(1, (t - BOOT_FILL_S + 0.3) / 0.3) : 0
  const capTop = top + rad
  const parts = [
    `M${BAR.right} ${r(Math.min(capTop, BAR.bottom - rad))}`,
    `L${BAR.right} ${r(BAR.bottom - rad)}`,
    `C${BAR.right} ${r(BAR.bottom - rad + k)} ${r(mid + k)} ${BAR.bottom} ${mid} ${BAR.bottom}`,
    `C${r(mid - k)} ${BAR.bottom} ${BAR.left} ${r(BAR.bottom - rad + k)} ${BAR.left} ${r(BAR.bottom - rad)}`,
    `L${BAR.left} ${r(Math.min(capTop, BAR.bottom - rad))}`
  ]
  if (round > 0) {
    parts.push(`C${BAR.left} ${r(capTop - k * round)} ${r(mid - k)} ${r(top + (1 - round) * wave)} ${mid} ${r(top)}`)
    parts.push(`C${r(mid + k)} ${r(top - (1 - round) * wave)} ${BAR.right} ${r(capTop - k * round)} ${BAR.right} ${r(capTop)} Z`)
  } else {
    parts.push(`C${BAR.left} ${r(top + 1)} ${r(mid - 2)} ${r(top + wave)} ${mid} ${r(top)}`)
    parts.push(`C${r(mid + 2)} ${r(top - wave)} ${BAR.right} ${r(top + 1)} ${BAR.right} ${r(capTop)} Z`)
  }
  return parts.join(' ')
}

/** Contorno del tubo vuoto (si vede mentre si riempie). */
export function tubeOutline(): string {
  const rad = (BAR.right - BAR.left) / 2
  const mid = BAR.left + rad
  return `M${mid} ${BAR.top} A${rad} ${rad} 0 0 1 ${BAR.right} ${BAR.top + rad} L${BAR.right} ${BAR.bottom - rad} A${rad} ${rad} 0 0 1 ${BAR.left} ${BAR.bottom - rad} L${BAR.left} ${BAR.top + rad} A${rad} ${rad} 0 0 1 ${mid} ${BAR.top} Z`
}
