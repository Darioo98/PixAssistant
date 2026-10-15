import { describe, expect, it } from 'vitest'
import { splitLift, windowBounds, LAYOUT } from '@shared/layout'
import { comboToAccelerator } from '@shared/accelerator'
import { coerceSettings, DEFAULT_SETTINGS } from '@shared/settings'
import { resolveLang } from '@shared/i18n'

describe('windowBounds', () => {
  it("si ancora in basso a destra dell'area di lavoro", () => {
    const b = windowBounds({ x: 0, y: 0, width: 1920, height: 1040 })
    expect(b.x + b.width).toBe(1920)
    expect(b.y + b.height).toBe(1040)
    expect(b.width).toBe(LAYOUT.panelWidth + LAYOUT.pixColumn + LAYOUT.margin)
  })

  it('segue la barra delle applicazioni a destra e i monitor con origine negativa', () => {
    const b = windowBounds({ x: -1280, y: 0, width: 1232, height: 1024 })
    expect(b.x + b.width).toBe(-48)
  })

  it('non supera schermi piccoli', () => {
    const b = windowBounds({ x: 0, y: 0, width: 800, height: 560 })
    expect(b.height).toBe(560)
    expect(b.y).toBe(0)
  })
})

describe('comboToAccelerator', () => {
  const k = (code: string, m: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...m
  })

  it('costruisce combinazioni valide', () => {
    expect(comboToAccelerator(k('Space', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+Space')
    expect(comboToAccelerator(k('KeyD', { metaKey: true, shiftKey: true }))).toBe('Shift+Super+D')
  })

  it('rifiuta tasti senza modificatori o solo con Maiusc', () => {
    expect(comboToAccelerator(k('KeyA'))).toBeNull()
    expect(comboToAccelerator(k('KeyA', { shiftKey: true }))).toBeNull()
    expect(comboToAccelerator(k('IntlBackslash', { ctrlKey: true }))).toBeNull()
  })
})

describe('impostazioni e lingua', () => {
  it('scarta solo i valori non validi', () => {
    const s = coerceSettings({ theme: 'dark', language: 'fr', closeOnBlur: 'sì' })
    expect(s.theme).toBe('dark')
    expect(s.language).toBe(DEFAULT_SETTINGS.language)
    expect(s.closeOnBlur).toBe(DEFAULT_SETTINGS.closeOnBlur)
  })

  it('segue la lingua di Windows', () => {
    expect(resolveLang('system', ['en-GB', 'it-IT'])).toBe('en')
    expect(resolveLang('system', ['de-DE'])).toBe('it')
    expect(resolveLang('en', ['it-IT'])).toBe('en')
  })
})

describe('barra spostabile', () => {
  it('sale prima con la finestra, poi dentro la finestra, senza uscire dallo schermo', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 }
    const h = LAYOUT.panelHeight + 2 * LAYOUT.margin
    expect(splitLift(area, 100)).toEqual({ lift: 100, shift: 100, inner: 0 })
    expect(splitLift(area, 600)).toEqual({ lift: 600, shift: 1040 - h, inner: 600 - (1040 - h) })
    expect(splitLift(area, 99999).lift).toBe(1040 - LAYOUT.barBottom - LAYOUT.barHeight - 10)
    expect(splitLift(area, -50).lift).toBe(0)
    expect(windowBounds(area, 100).y).toBe(1040 - h - 100)
  })
})
