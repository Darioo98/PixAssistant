import { describe, expect, it } from 'vitest'
import { BOOT_FILL_S, bootBarPath } from '../src/renderer/src/pix/bootFill'

const ys = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]))

describe('avvio con Windows', () => {
  it('la barra si riempie dal basso fino a tornare intera', () => {
    expect(bootBarPath(0, 0)).toBe('')
    const half = ys(bootBarPath(0.5, 0.6))
    expect(Math.max(...half)).toBeCloseTo(230, 0)
    expect(Math.min(...half)).toBeGreaterThan(130)
    const full = ys(bootBarPath(1, BOOT_FILL_S + 0.7))
    expect(Math.min(...full)).toBeCloseTo(50, 0)
    expect(Math.max(...full)).toBeCloseTo(230, 0)
  })
})
