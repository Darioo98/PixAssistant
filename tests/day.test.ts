import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSummary, hasTension, todosLeftToday } from '@shared/day'
import type { Deadline } from '@shared/deadlines'
import type { Reminder, Todo } from '@shared/productivity'
import { DayService } from '../src/main/day'

const today = '2026-10-14'
const dl = (title: string, date: string, extra: Partial<Deadline> = {}): Deadline => ({
  title,
  date,
  anchorDay: 1,
  recurrence: { unit: 'none', every: 1 },
  leadDays: null,
  category: '',
  notes: '',
  doneAt: null,
  snoozedUntil: null,
  history: [],
  ...extra
})
const todo = (text: string, extra: Partial<Todo> = {}): Todo => ({ text, done: false, doneAt: null, due: null, priority: 'normal', today: false, ...extra })
const rem = (text: string, at: string): Reminder => ({ text, at, repeat: 'none', anchorDay: 1, snoozedUntil: null, done: false })
const t = (key: string, o?: Record<string, unknown>) => `${key}${o ? JSON.stringify(o) : ''}`

describe('giornata di Pix', () => {
  it('è teso con scadenze di oggi o domani e to-do in ritardo', () => {
    expect(hasTension([dl('a', '2026-10-15')], [], today)).toBe(true)
    expect(hasTension([dl('a', '2026-10-20')], [], today)).toBe(false)
    expect(hasTension([dl('a', '2026-10-10', { doneAt: 1 })], [], today)).toBe(false)
    expect(hasTension([dl('a', '2026-10-14', { snoozedUntil: '2026-10-16' })], [], today)).toBe(false)
    expect(hasTension([], [todo('x', { due: '2026-10-13' })], today)).toBe(true)
    expect(hasTension([], [todo('x', { due: '2026-10-14' })], today)).toBe(false)
  })

  it('compone il riepilogo del mattino', () => {
    const text = buildSummary(
      {
        now: new Date(2026, 9, 14, 8, 30),
        deadlines: [dl('Bollo', '2026-10-14'), dl('Dopo', '2026-11-01')],
        todos: [todo('a', { today: true }), todo('b')],
        reminders: [rem('Chiamare Marco', '2026-10-14T15:30'), rem('Ieri', '2026-10-13T10:00')],
        shiftEndsAt: new Date(2026, 9, 14, 17, 47).getTime(),
        weather: { city: 'Bari', temperature: 18.4, min: 12, max: 21, icon: '☀️' }
      },
      today,
      t
    )
    const lines = text.split('\n')
    expect(lines[0]).toBe('day.summary.morning')
    expect(lines[1]).toContain('17:47')
    expect(lines[2]).toContain('"names":"Bollo"')
    expect(lines[3]).toContain('day.summary.todos{"count":1}')
    expect(lines[4]).toContain('"time":"15:30"')
    expect(lines[5]).toContain('"temp":18')
    expect(todosLeftToday([todo('a', { today: true }), todo('b', { today: true, done: true })], today)).toBe(1)
  })

  it('conta i cicli di focus e mostra il riepilogo una volta al giorno', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pix-day-'))
    try {
      let now = new Date(2026, 9, 14, 4, 0)
      const day = new DayService(dir, () => now)
      await day.init()
      expect(day.summaryDue()).toBe(false) // troppo presto
      now = new Date(2026, 9, 14, 8, 0)
      expect(day.summaryDue()).toBe(true)
      day.markSummary()
      expect(day.addCycle()).toBe(1)
      expect(day.addCycle()).toBe(2)
      await day.flush()
      const again = new DayService(dir, () => now)
      await again.init()
      expect(again.summaryDue()).toBe(false)
      expect(again.cyclesToday()).toBe(2)
      now = new Date(2026, 9, 15, 8, 0)
      expect(again.cyclesToday()).toBe(0)
      expect(again.summaryDue()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
