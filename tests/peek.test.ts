import { describe, expect, it } from 'vitest'
import { PEEK_DURATION_S, SCARE_DURATION_S, headOf, peekBodyPath, peekFrame, scaredFrame } from '../src/renderer/src/pix/peekMotion'

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

  it('sbatte le palpebre quando è fuori, poi si spaventa', () => {
    expect(peekFrame(2.31).eyeOpen).toBeLessThan(0.3)
    expect(peekFrame(3.3).eyeScale).toBeGreaterThan(1.2)
    expect(peekFrame(3.3).sweat).toBeGreaterThan(0.9)
  })

  it('viene risucchiato di colpo e la barra fa un’onda d’urto', () => {
    expect(peekFrame(3.45).grow).toBeGreaterThan(0.8)
    expect(peekFrame(3.7).grow).toBe(0)
    const bar = (t: number) => coords(peekBodyPath(peekFrame(t), 140, 1, 'squircle'))
    // l'onda è partita: il bordo sinistro sporge sopra e sotto il punto del risucchio
    const bulge = (t: number, near: number) => Math.min(...bar(t).filter((p) => Math.abs(p[1] - near) < 4).map((p) => p[0]))
    expect(bulge(3.8, 140 - 17)).toBeLessThan(86)
    expect(bulge(3.8, 140 + 17)).toBeLessThan(86)
    // mentre è fuori la barra è molto più corta
    const height = (t: number) => { const ys = bar(t).map((p) => p[1]); return Math.max(...ys) - Math.min(...ys) }
    expect(height(2.5)).toBeLessThan(140)
  })

  it('spaventato: sobbalza con gli occhi tondi, rientra di colpo e la barra trema di più', () => {
    const from = peekFrame(2)
    expect(scaredFrame(from, 0.1).startle).toBe(1)
    expect(scaredFrame(from, 0.1).grow).toBeGreaterThan(0.9)
    expect(scaredFrame(from, SCARE_DURATION_S - 1.3).grow).toBe(0) // risucchiato in un decimo di secondo
    const bar = (f: ReturnType<typeof peekFrame>) => Math.min(...coords(peekBodyPath(f, 140, 1, 'squircle')).map((p) => p[0]))
    const calm = bar(peekFrame(3.68 + 0.04))
    const scared = bar(scaredFrame(from, 0.33 + 0.04))
    expect(scared).toBeLessThan(calm) // onda d'urto più forte
    expect(bar(scaredFrame(from, SCARE_DURATION_S - 0.01))).toBeCloseTo(88, 0)
  })

})
