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
