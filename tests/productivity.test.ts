import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterFired,
  compareTodos,
  formatDuration,
  formatLocal,
  isTodoForToday,
  nextPomodoro,
  parseLocal,
  stepReminder,
  type Reminder,
  type Todo
} from '@shared/productivity'
import { ReminderService, TimerService, TodoService } from '../src/main/productivity'

describe('promemoria', () => {
  it('ripete ogni giorno, nei feriali, ogni settimana e ogni mese (fine mese compreso)', () => {
    expect(stepReminder('2026-10-16T15:00', 'day', 16)).toBe('2026-10-17T15:00')
    expect(stepReminder('2026-10-16T15:00', 'weekdays', 16)).toBe('2026-10-19T15:00') // venerdì → lunedì
    expect(stepReminder('2026-10-16T15:00', 'week', 16)).toBe('2026-10-23T15:00')
    expect(stepReminder('2027-01-31T09:30', 'month', 31)).toBe('2027-02-28T09:30')
    expect(stepReminder('2027-02-28T09:30', 'month', 31)).toBe('2027-03-31T09:30')
  })

  it("resta all'ora locale anche con il cambio dell'ora legale", () => {
    const at = stepReminder('2027-03-27T15:00', 'day', 27) // la notte del 28 marzo si passa all'ora legale
    expect(at).toBe('2027-03-28T15:00')
    expect(parseLocal(at).getHours()).toBe(15)
    expect(formatLocal(new Date(2027, 2, 28, 15, 0))).toBe('2027-03-28T15:00')
  })

  it('dopo essere stato mostrato: il singolo si chiude, il ripetuto salta le occorrenze perse', () => {
    const base: Reminder = { text: 'x', at: '2026-10-10T08:00', repeat: 'none', anchorDay: 10, snoozedUntil: null, done: false }
    expect(afterFired(base, Date.now()).done).toBe(true)
    const now = new Date(2026, 9, 14, 12, 0).getTime()
    expect(afterFired({ ...base, repeat: 'day' }, now).at).toBe('2026-10-15T08:00')
  })
})

describe('to-do e Pomodoro', () => {
  const todo = (over: Partial<Todo>): Todo => ({ text: 'x', done: false, doneAt: null, due: null, priority: 'normal', today: false, ...over })

  it('riconosce i to-do di oggi e li ordina', () => {
    expect(isTodoForToday(todo({ due: '2026-10-14' }), '2026-10-14')).toBe(true)
    expect(isTodoForToday(todo({ due: '2026-10-10' }), '2026-10-14')).toBe(true)
    expect(isTodoForToday(todo({ due: '2026-10-20' }), '2026-10-14')).toBe(false)
    expect(isTodoForToday(todo({ today: true }), '2026-10-14')).toBe(true)
    expect(isTodoForToday(todo({ today: true, done: true }), '2026-10-14')).toBe(false)
    const list = [todo({ text: 'c' }), todo({ text: 'b', due: '2026-10-20' }), todo({ text: 'a', due: '2026-10-15', priority: 'high' }), todo({ text: 'z', done: true })]
    expect(list.sort(compareTodos).map((x) => x.text)).toEqual(['a', 'b', 'c', 'z'])
  })

  it('alterna lavoro e pause, con la pausa lunga ogni 4 cicli', () => {
    const cfg = { work: 25, short: 5, long: 15, longEvery: 4 }
    let s = { phase: 'work' as const as 'work' | 'short' | 'long', completedWork: 0 }
    const seq: string[] = []
    for (let i = 0; i < 8; i++) {
      s = nextPomodoro(s.phase, s.completedWork, cfg)
      seq.push(s.phase)
    }
    expect(seq).toEqual(['short', 'work', 'short', 'work', 'short', 'work', 'long', 'work'])
  })

  it('formatta i tempi', () => {
    expect(formatDuration(25 * 60_000)).toBe('25:00')
    expect(formatDuration(61_000)).toBe('1:01')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})

describe('servizi', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pix-prod-'))
  })
  afterEach(async () => {
    vi.useRealTimers()
    await rm(dir, { recursive: true, force: true })
  })
  const deps = () => ({
    dataDir: dir,
    device: { id: 'pc1-0000-0000', name: 'pc1' },
    codec: () => ({ encode: (s: string) => s, decode: (s: string) => s }),
    onError: () => undefined
  })

  it('i promemoria persi si mostrano una volta; in "non disturbare" aspettano', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 14, 12, 0))
    const fired: string[] = []
    let quiet = true
    const svc = new ReminderService(deps(), { isQuiet: () => quiet, fire: (r) => fired.push(r.text) })
    svc.apply({ op: 'save', text: 'chiama', at: '2026-10-14T09:00', repeat: 'none' })
    svc.check()
    expect(fired).toEqual([])
    quiet = false
    svc.check()
    svc.check()
    expect(fired).toEqual(['chiama'])
    expect(svc.list()[0]!.done).toBe(true)
    svc.dispose()
    vi.useRealTimers()
    await svc.store.flush()
  })

  it('posticipa e scatta all’orario', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 14, 14, 59))
    const fired: string[] = []
    const svc = new ReminderService(deps(), { isQuiet: () => false, fire: (r) => fired.push(r.text) })
    svc.apply({ op: 'save', text: 'commercialista', at: '2026-10-14T15:00', repeat: 'none' })
    vi.advanceTimersByTime(61_000)
    expect(fired).toEqual(['commercialista'])
    const id = svc.list()[0]!.id
    svc.snooze(id, 10)
    vi.advanceTimersByTime(9 * 60_000)
    expect(fired).toHaveLength(1)
    vi.advanceTimersByTime(2 * 60_000)
    expect(fired).toEqual(['commercialista', 'commercialista'])
    svc.dispose()
    vi.useRealTimers()
    await svc.store.flush()
  })

  it('segnare un to-do come fatto fa festeggiare Pix', async () => {
    let party = 0
    const svc = new TodoService(deps(), () => party++)
    const id = svc.apply({ op: 'save', todo: { text: 'spesa', due: null, priority: 'normal', today: true } }) as string
    svc.apply({ op: 'toggle', id })
    expect(party).toBe(1)
    expect(svc.list()[0]!.done).toBe(true)
    await svc.store.flush()
  })

  it('timer: pausa, ripresa e fine; il Pomodoro aspetta la fase successiva', async () => {
    vi.useFakeTimers()
    const finished: string[] = []
    const timers = new TimerService(dir, {
      pomodoro: () => ({ work: 25, short: 5, long: 15, longEvery: 4 }),
      labels: () => ({ work: 'Lavoro', short: 'Pausa', long: 'Pausa lunga', timer: 'Timer' }),
      finished: (t) => finished.push(`${t.label}:${t.state}`)
    })
    await timers.init()
    const id = timers.apply({ op: 'startCustom', label: 'Pasta', minutes: 10 }) as string
    vi.advanceTimersByTime(4 * 60_000)
    timers.apply({ op: 'pause', id })
    vi.advanceTimersByTime(60 * 60_000)
    expect(finished).toEqual([])
    timers.apply({ op: 'resume', id })
    vi.advanceTimersByTime(6 * 60_000 + 10)
    expect(finished).toEqual(['Pasta:done'])
    expect(timers.list()).toHaveLength(0)

    const pomo = timers.apply({ op: 'startPomodoro' }) as string
    vi.advanceTimersByTime(25 * 60_000 + 10)
    expect(finished.at(-1)).toBe('Lavoro:waiting')
    timers.apply({ op: 'next', id: pomo })
    expect(timers.list()[0]).toMatchObject({ phase: 'short', completedWork: 1, state: 'running', label: 'Pausa' })
    timers.dispose()
    vi.useRealTimers()
    await timers.flush()
  })
})
