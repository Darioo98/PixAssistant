import { describe, expect, it } from 'vitest'
import { PIX_SHAPES, eyeColorFor, lighten, moodColor, MOOD_COLORS } from '@shared/mascot'
import { coerceSettings, DEFAULT_SETTINGS } from '@shared/settings'
import { BODY_SHAPES, bodyAt, morphFor, pixPath, SHAPES } from '../src/renderer/src/pix/geometry'

describe('colori di Pix', () => {
  it('usa il colore scelto per normale, pensa e saluto e tiene fissi gli altri stati', () => {
    expect(moodColor('normal', '#EC4899')).toBe('#EC4899')
    expect(moodColor('think', '#EC4899')).toBe('#EC4899')
    expect(moodColor('alert', '#EC4899')).toBe(MOOD_COLORS.alert)
    expect(moodColor('sleep', '#EC4899')).toBe(MOOD_COLORS.sleep)
    expect(moodColor('normal', 'rosso')).toBe(MOOD_COLORS.normal)
  })

  it('schiarisce verso il bianco', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080')
    expect(lighten('#6366f1', 0)).toBe('#6366f1')
    expect(lighten('#6366f1', 1)).toBe('#ffffff')
  })

  it('sceglie occhi leggibili', () => {
    expect(eyeColorFor('#6366F1')).toBe('#FFFFFF')
    expect(eyeColorFor('#FDE68A')).not.toBe('#FFFFFF')
  })

  it('scarta colori e forme non validi dalle impostazioni', () => {
    const s = coerceSettings({ pixColor: 'blu', pixShape: 'stella', pixEyes: 'dot' })
    expect(s.pixColor).toBe(DEFAULT_SETTINGS.pixColor)
    expect(s.pixShape).toBe(DEFAULT_SETTINGS.pixShape)
    expect(s.pixEyes).toBe('dot')
  })
})

describe('forme di Pix', () => {
  it.each(PIX_SHAPES)('la forma %s poggia sulla base e si trasforma dalla barra', (shape) => {
    const ys = (BODY_SHAPES[shape].path.match(/-?\d*\.?\d+/g) ?? []).map(Number).filter((_, i) => i % 2 === 1)
    expect(Math.max(...ys)).toBe(226)
    const m = morphFor(1, shape)
    expect(bodyAt(m, 0, true)).toBe(SHAPES.bar)
    expect(bodyAt(m, 1, true)).toBe(pixPath(1, shape))
    expect(bodyAt(m, 0.8, true)).toMatch(/^M/)
  })
})

describe('selettore di colore', () => {
  it('converte HEX <-> HSV senza perdite', async () => {
    const { hexToHsv, hsvToHex } = await import('@shared/color')
    for (const hex of ['#6366F1', '#000000', '#FFFFFF', '#F97362', '#22B07D', '#0EA5E9']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex)
    }
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#FF0000')
  })
})

describe('animazioni del fluido', () => {
  it('sceglie un’animazione spontanea diversa dall’ultima; antenne e cuore per gli stati', async () => {
    const { pickTransform, moodTransform } = await import('@shared/mascot')
    for (let i = 0; i < 50; i++) expect(pickTransform('wobble', Math.random)).not.toBe('wobble')
    expect(moodTransform('think')).toBe('antennae')
    expect(moodTransform('happy')).toBe('heart')
    expect(moodTransform('normal')).toBeNull()
  })

  it('il corpo resta un unico contorno che si muove nel tempo e torna com’era', async () => {
    const { restBody, liveShape, SAMPLES } = await import('../src/renderer/src/pix/shapes')
    const { PIX_TRANSFORMS } = await import('@shared/mascot')
    const body = restBody(1, 'squircle')
    expect(body.pts).toHaveLength(SAMPLES)
    const dist = (a: [number, number][], b: [number, number][]) => a.reduce((s, [x, y], i) => s + Math.hypot(x - b[i]![0], y - b[i]![1]), 0) / a.length
    for (const k of PIX_TRANSFORMS) {
      const at0 = liveShape(body, k, 1, 0)
      const at1 = liveShape(body, k, 1, 1)
      const at2 = liveShape(body, k, 1.4, 1)
      expect(at1).toHaveLength(SAMPLES)
      expect(at1.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
      expect(dist(at0, body.pts)).toBeLessThan(0.01) // ampiezza 0 = forma a riposo
      expect(dist(at1, body.pts)).toBeGreaterThan(0.5) // si deforma davvero
      if (k !== 'melt') expect(dist(at1, at2)).toBeGreaterThan(0.05) // e si muove nel tempo
    }
    const maxY = (pts: [number, number][]) => Math.max(...pts.map((q) => q[1]))
    expect(maxY(liveShape(body, 'tentacles', 1, 1))).toBeGreaterThan(maxY(body.pts) + 10)
    // Il cuore batte: in due istanti diversi ha dimensioni diverse
    const w = (pts: [number, number][]) => Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0]))
    expect(Math.abs(w(liveShape(body, 'heart', 0.08, 1)) - w(liveShape(body, 'heart', 0.5, 1)))).toBeGreaterThan(2)
  })
})
