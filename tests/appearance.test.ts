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

describe('trasformazioni', () => {
  it('sceglie una trasformazione diversa dall’accessorio fisso e dall’ultima', async () => {
    const { pickTransform, moodTransform } = await import('@shared/mascot')
    for (let i = 0; i < 50; i++) {
      const x = pickTransform('horns', 'ears', Math.random)
      expect(x).not.toBe('horns')
      expect(x).not.toBe('ears')
    }
    expect(moodTransform('think')).toBe('antennae')
    expect(moodTransform('normal')).toBeNull()
  })
})

describe('trasformazioni del corpo (un unico fluido)', () => {
  it('ogni forma ha gli stessi punti della base: il morph è continuo', async () => {
    const { shapePoints, lerpPoints, SAMPLES } = await import('../src/renderer/src/pix/shapes')
    const { PIX_TRANSFORMS } = await import('@shared/mascot')
    const base = shapePoints(1, 'squircle', null)
    expect(base).toHaveLength(SAMPLES)
    const maxY = (pts: number[][]) => Math.max(...pts.map((p) => p[1]!))
    const minY = (pts: number[][]) => Math.min(...pts.map((p) => p[1]!))
    for (const k of PIX_TRANSFORMS) {
      const pts = shapePoints(1, 'squircle', k)
      expect(pts).toHaveLength(SAMPLES)
      expect(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
    }
    // Le corna crescono verso l'alto senza toccare il fondo del corpo
    const horns = shapePoints(1, 'squircle', 'horns')
    expect(minY(horns)).toBeLessThan(minY(base) - 15)
    expect(maxY(horns)).toBeCloseTo(maxY(base), 0)
    // Le gocce colano sotto la base
    expect(maxY(shapePoints(1, 'squircle', 'melt'))).toBeGreaterThan(maxY(base) + 10)
    // Il cuore è allineato: i punti non "girano" attorno al corpo durante il morph
    const heart = shapePoints(1, 'squircle', 'heart')
    const avgShift = heart.reduce((s, [x, y], i) => s + Math.hypot(x - base[i]![0], y - base[i]![1]), 0) / SAMPLES
    expect(avgShift).toBeLessThan(15)
    // Oltre t = 1 la forma va un po' oltre (effetto gelatina)
    const over = lerpPoints(base, horns, 1.1)
    expect(minY(over)).toBeLessThan(minY(horns))
  })
})
