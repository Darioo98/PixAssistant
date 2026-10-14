import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatHHMM, formatRemaining, minutesOf, shiftEnd, shiftProgress, type Shift } from '@shared/shift'
import { ShiftService } from '../src/main/shift'

const labels = { h: 'h', min: 'min' }

describe('calcolo del turno', () => {
  const s: Shift = { date: '2026-10-14', arrival: '08:47', workMinutes: 480, breakMinutes: 60 }

  it('fine turno = arrivo + lavoro + pausa', () => {
    const end = shiftEnd(s)
    expect(formatHHMM(end.getHours() * 60 + end.getMinutes())).toBe('17:47')
    expect(shiftEnd({ ...s, breakMinutes: 30 }).getHours()).toBe(17)
    expect(shiftEnd({ ...s, arrival: '09:15', workMinutes: 360, breakMinutes: 0 }).getHours()).toBe(15)
  })

  it('formatta il tempo che manca e l’avanzamento', () => {
    expect(formatRemaining(2 * 3_600_000 + 13 * 60_000, labels)).toBe('2 h 13 min')
    expect(formatRemaining(45 * 60_000, labels)).toBe('45 min')
    expect(formatRemaining(3 * 3_600_000, labels)).toBe('3 h')
    expect(formatRemaining(30_000, labels)).toBe('1 min')
    const mid = new Date(2026, 9, 14, 13, 17).getTime()
    expect(shiftProgress(s, mid)).toBeCloseTo(0.5, 2)
    expect(minutesOf('08:47')).toBe(527)
  })
})

describe('ShiftService', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dock-shift-'))
    vi.useFakeTimers()
  })
  afterEach(async () => {
    vi.useRealTimers()
    await rm(dir, { recursive: true, force: true })
  })

  it('propone l’ora del primo utilizzo e avvisa prima e alla fine del turno', async () => {
    vi.setSystemTime(new Date(2026, 9, 14, 8, 52))
    const events: string[] = []
    const svc = new ShiftService({
      localDir: dir,
      config: () => ({ workMinutes: 480, breakMinutes: 60, remindBefore: 15 }),
      remind: (m, end) => events.push(`mancano ${m} (${end.getHours()}:${end.getMinutes()})`),
      ended: () => events.push('fine')
    })
    await svc.init()
    expect(svc.state().suggestedArrival).toBe('08:52')

    await svc.apply({ op: 'start', arrival: '08:47' })
    expect(svc.state().shift).toMatchObject({ arrival: '08:47', breakMinutes: 60 })

    vi.setSystemTime(new Date(2026, 9, 14, 17, 31)) // il tempo "salta": riprogrammo come dopo una modifica
    await svc.apply({ op: 'adjust', breakMinutes: 60 })
    vi.advanceTimersByTime(60_000)
    expect(events).toEqual(['mancano 15 (17:47)'])
    vi.advanceTimersByTime(15 * 60_000)
    expect(events).toEqual(['mancano 15 (17:47)', 'fine'])

    // Pausa più corta: la fine si anticipa
    await svc.apply({ op: 'adjust', breakMinutes: 30 })
    const end = new Date(svc.state().endsAt!)
    expect(`${end.getHours()}:${end.getMinutes()}`).toBe('17:17')
    svc.dispose()
  })

  it('il turno vale solo per oggi', async () => {
    vi.setSystemTime(new Date(2026, 9, 14, 9, 0))
    const make = () =>
      new ShiftService({ localDir: dir, config: () => ({ workMinutes: 480, breakMinutes: 60, remindBefore: 0 }), remind: () => undefined, ended: () => undefined })
    const a = make()
    await a.init()
    await a.apply({ op: 'start', arrival: '09:00' })
    a.dispose()
    vi.setSystemTime(new Date(2026, 9, 15, 8, 30))
    const b = make()
    await b.init()
    expect(b.state().shift).toBeNull()
    expect(b.state().suggestedArrival).toBe('08:30')
    b.dispose()
  })
})
