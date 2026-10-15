import { describe, expect, it } from 'vitest'
import { PEEK_DURATION_S, peekFrame } from '../src/renderer/src/pix/peekMotion'

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
})
