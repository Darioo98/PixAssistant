import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inTimeRange, resolveMood } from '@shared/mascot'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { MascotService } from '../src/main/mascot'
import { bodyAt, mapPath, morphFor, remapOnReverse, SHAPES } from '../src/renderer/src/pix/geometry'

const at = (hh: number, mm = 0) => new Date(2026, 9, 14, hh, mm)

describe('inTimeRange', () => {
  it('gestisce fasce nella stessa giornata e a cavallo della mezzanotte', () => {
    expect(inTimeRange(at(13), '09:00', '18:00')).toBe(true)
    expect(inTimeRange(at(18), '09:00', '18:00')).toBe(false)
    expect(inTimeRange(at(23, 30), '22:00', '07:00')).toBe(true)
    expect(inTimeRange(at(6, 59), '22:00', '07:00')).toBe(true)
    expect(inTimeRange(at(7), '22:00', '07:00')).toBe(false)
  })

  it('ignora orari non validi o fasce vuote', () => {
    expect(inTimeRange(at(10), '25:00', '07:00')).toBe(false)
    expect(inTimeRange(at(10), '10:00', '10:00')).toBe(false)
  })
})

describe('resolveMood', () => {
  it('rispetta le priorità', () => {
    const base = { bubbleAlert: false, thinking: false, transient: null, asleep: false }
    expect(resolveMood(base)).toBe('normal')
    expect(resolveMood({ ...base, asleep: true })).toBe('sleep')
    expect(resolveMood({ ...base, asleep: true, transient: 'happy' })).toBe('happy')
    expect(resolveMood({ ...base, transient: 'happy', thinking: true })).toBe('think')
    expect(resolveMood({ ...base, thinking: true, bubbleAlert: true })).toBe('alert')
  })
})

describe('MascotService', () => {
  let settings: Settings
  let now: Date
  let idle: number
  const make = () =>
    new MascotService({
      settings: () => settings,
      idleSeconds: () => idle,
      canShowBubbles: () => true,
      onChange: () => undefined,
      now: () => now
    })

  beforeEach(() => {
    vi.useFakeTimers()
    settings = { ...DEFAULT_SETTINGS }
    now = at(12)
    idle = 0
  })
  afterEach(() => vi.useRealTimers())

  it('mostra un fumetto alla volta e passa al successivo dopo la chiusura', () => {
    const m = make()
    const outcomes: string[] = []
    const a = m.notify({ category: 'Scadenze', text: 'A', onOutcome: (o) => outcomes.push(`A:${o.kind}`) })
    m.notify({ category: 'Password', text: 'B', onOutcome: (o) => outcomes.push(`B:${o.kind}`) })
    expect(m.state().bubble?.text).toBe('A')
    expect(m.state().queued).toBe(1)
    expect(m.state().mood).toBe('alert')

    m.resolveBubble(a!, { kind: 'action', actionId: 'done' })
    expect(outcomes).toEqual(['A:action'])
    expect(m.state().bubble).toBeNull()
    vi.advanceTimersByTime(700)
    expect(m.state().bubble?.text).toBe('B')
    m.dispose()
  })

  it('ignora esiti per fumetti non più visibili', () => {
    const m = make()
    const a = m.notify({ category: 'X', text: 'A' })!
    m.resolveBubble('altro', { kind: 'dismiss' })
    expect(m.state().bubble?.id).toBe(a)
    m.dispose()
  })

  it('non mostra fumetti in "non disturbare" o con le notifiche in pausa', () => {
    settings = { ...settings, dndEnabled: true, dndFrom: '22:00', dndTo: '07:00' }
    now = at(23)
    const m = make()
    expect(m.notify({ category: 'X', text: 'A' })).toBeNull()
    now = at(12)
    settings = { ...settings, notificationsPaused: true }
    expect(m.notify({ category: 'X', text: 'A' })).toBeNull()
    m.dispose()
  })

  it('chiude comunque il fumetto se il renderer non risponde', () => {
    const m = make()
    const outcomes: string[] = []
    m.notify({ category: 'X', text: 'A', onOutcome: (o) => outcomes.push(o.kind) })
    vi.advanceTimersByTime(settings.bubbleSeconds * 1000 * 3 + 5000)
    expect(outcomes).toEqual(['timeout'])
    m.dispose()
  })

  it('dorme di notte e dopo molta inattività, e si sveglia quando torni', () => {
    now = at(2)
    const night = make()
    expect(night.state().mood).toBe('sleep')
    night.dispose()

    now = at(15)
    idle = 20 * 60
    const m = make()
    expect(m.state().mood).toBe('sleep')
    m.wake()
    expect(m.state().mood).toBe('normal')
    m.dispose()
  })

  it('gli stati momentanei finiscono da soli', () => {
    const m = make()
    m.celebrate()
    expect(m.state()).toMatchObject({ mood: 'happy', spotlight: true })
    vi.advanceTimersByTime(3000)
    expect(m.state()).toMatchObject({ mood: 'normal', spotlight: false })
    m.dispose()
  })
})

describe('geometria del morph', () => {
  it('sposta le coordinate dei tracciati', () => {
    expect(mapPath('M1 2 L3 4 Z', (x, y) => [x + 10, y * 2])).toBe('M11 4 L13 8 Z')
    expect(SHAPES.bar.startsWith('M92 50')).toBe(true)
  })

  it("l'inversione a metà dell'ultimo tratto non cambia la forma", () => {
    const m = morphFor(1)
    for (const p of [0.6, 0.7, 0.8, 0.95]) {
      const back = remapOnReverse(p, false)
      expect(numbersOf(bodyAt(m, back, false))).toBeCloseToArray(numbersOf(bodyAt(m, p, true)), 0.05)
      const fwd = remapOnReverse(0.7, true)
      expect(numbersOf(bodyAt(m, fwd, true))).toBeCloseToArray(numbersOf(bodyAt(m, 0.7, false)), 1.5)
    }
  })

  it('agli estremi restituisce esattamente barra e Pix', () => {
    const m = morphFor(1.2)
    expect(bodyAt(m, 0, true)).toBe(SHAPES.bar)
    expect(bodyAt(m, 1, true)).toBe(m.pix)
  })
})

function numbersOf(d: string): number[] {
  return (d.match(/-?\d*\.?\d+/g) ?? []).map(Number)
}

expect.extend({
  toBeCloseToArray(received: number[], expected: number[], tolerance: number) {
    const pass =
      received.length === expected.length && received.every((v, i) => Math.abs(v - (expected[i] ?? NaN)) <= tolerance)
    return { pass, message: () => `forme diverse oltre ${tolerance} px` }
  }
})

declare module 'vitest' {
  interface Assertion<T> {
    toBeCloseToArray(expected: number[], tolerance: number): T
  }
}
