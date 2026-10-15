import { describe, expect, it } from 'vitest'
import { PEEK_DURATION_S, consumedBarPath, peekFrame } from '../src/renderer/src/pix/peekMotion'

describe('sbirciata', () => {
  it('parte e finisce nascosto, in mezzo è fuori e sbatte le palpebre', () => {
    expect(peekFrame(0).d).toBeGreaterThanOrEqual(1)
    expect(peekFrame(PEEK_DURATION_S - 0.1).d).toBeGreaterThanOrEqual(1)
    expect(peekFrame(1.2).d).toBeCloseTo(0.38, 2) // un occhio solo
    expect(peekFrame(3).d).toBeLessThan(0.1)
    expect(peekFrame(3.28).eyeOpen).toBeLessThan(0.3)
  })

  it('si deforma a volume costante', () => {
    for (let t = 0; t < PEEK_DURATION_S; t += 0.05) {
      const f = peekFrame(t)
      expect(f.sx * f.sy).toBeCloseTo(1, 6)
      expect(f.sx).toBeLessThan(1.5)
    }
  })

  it('la barra cede un po’ di fluido mentre Pix è fuori e torna intera alla fine', () => {
    expect(peekFrame(3).consumed).toBeCloseTo(1, 1)
    expect(peekFrame(0).consumed).toBeCloseTo(0, 6)
    expect(peekFrame(4.85).consumed).toBeLessThan(0) // piccolo rigonfiamento
    expect(Math.abs(peekFrame(PEEK_DURATION_S - 0.001).consumed)).toBeLessThan(0.01)
    const leftAt = (d: string, y: number) => [...d.matchAll(/L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const).reduce((a, b) => (Math.abs(b[1] - y) < Math.abs(a[1] - y) ? b : a))[0]
    expect(leftAt(consumedBarPath(1, 140), 140)).toBeGreaterThan(92) // incavo dove sbuca
    expect(leftAt(consumedBarPath(1, 140), 60)).toBeCloseTo(88, 1) // lontano resta intera
    expect(leftAt(consumedBarPath(0, 140), 140)).toBeCloseTo(88, 1)
  })
})
