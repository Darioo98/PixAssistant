import { describe, expect, it } from 'vitest'
import { PEEK_DURATION_S, headOf, peekBodyPath, peekFrame } from '../src/renderer/src/pix/peekMotion'

const coords = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)

describe('sbirciata', () => {
  it('parte e finisce come barra liscia', () => {
    const minX = (t: number) => Math.min(...coords(peekBodyPath(peekFrame(t), 140, 1, 'squircle')).map((p) => p[0]))
    expect(minX(0)).toBeCloseTo(88, 1)
    expect(minX(PEEK_DURATION_S - 0.01)).toBeCloseTo(88, 1)
    expect(minX(3)).toBeLessThan(60) // a metà la testa è fuori
  })

  it('la testa resta sempre attaccata alla barra con il collo', () => {
    for (let t = 0.2; t < 4.8; t += 0.1) {
      const f = peekFrame(t)
      const h = headOf(f, 140, 1, 'squircle')
      expect(88 - (h.cx + h.a)).toBeLessThanOrEqual(9.5)
      expect(f.gap).toBeGreaterThan(0)
    }
  })

  it('sbatte le palpebre quando è fuori', () => {
    expect(peekFrame(3.38).eyeOpen).toBeLessThan(0.3)
    expect(peekFrame(3).face).toBeCloseTo(1, 2)
  })
})
