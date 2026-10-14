import { describe, expect, it } from 'vitest'
import { addMonths, diffDays, isValidISODate, toISODate, weekday } from '@shared/dates'
import {
  compareByUrgency,
  deadlineStatus,
  fromInput,
  markDone,
  needsAlert,
  nextOccurrence,
  occurrencesBetween,
  reopen,
  snooze,
  type Deadline,
  type DeadlineInput
} from '@shared/deadlines'

const input = (over: Partial<DeadlineInput> = {}): DeadlineInput => ({
  title: 'Bollo auto',
  date: '2027-01-31',
  recurrence: { unit: 'none', every: 1 },
  leadDays: null,
  category: '',
  notes: '',
  ...over
})
const monthly = (date: string) => fromInput(input({ date, recurrence: { unit: 'month', every: 1 } }))

describe('date', () => {
  it('valida le date di calendario', () => {
    expect(isValidISODate('2028-02-29')).toBe(true)
    expect(isValidISODate('2027-02-29')).toBe(false)
    expect(isValidISODate('2027-13-01')).toBe(false)
    expect(isValidISODate('27-1-1')).toBe(false)
  })

  it("non risente dell'ora legale", () => {
    expect(diffDays('2027-03-27', '2027-03-29')).toBe(2)
    expect(diffDays('2027-10-30', '2027-11-01')).toBe(2)
    expect(toISODate(new Date(2027, 2, 28, 23, 30))).toBe('2027-03-28')
  })

  it('aggiunge mesi rispettando la fine del mese', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2027-02-28', 1, 31)).toBe('2027-03-31')
    expect(addMonths('2027-11-30', 3)).toBe('2028-02-29')
    expect(addMonths('2027-03-15', -3)).toBe('2026-12-15')
  })

  it('calcola il giorno della settimana', () => {
    expect(weekday('2026-10-14')).toBe(3) // mercoledì
  })
})

describe('ricorrenze', () => {
  it('"Fatto" su una mensile del 31 gennaio porta a fine febbraio e poi torna al 31', () => {
    let d = monthly('2027-01-31')
    d = markDone(d, 1)
    expect(d.date).toBe('2027-02-28')
    d = markDone(d, 2)
    expect(d.date).toBe('2027-03-31')
    d = markDone(d, 3)
    expect(d.date).toBe('2027-04-30')
    expect(d.history.map((h) => h.date)).toEqual(['2027-03-31', '2027-02-28', '2027-01-31'])
  })

  it('anno bisestile: annuale dal 29 febbraio', () => {
    const d = fromInput(input({ date: '2028-02-29', recurrence: { unit: 'year', every: 1 } }))
    expect(nextOccurrence(d.date, d.recurrence, d.anchorDay)).toBe('2029-02-28')
    expect(nextOccurrence('2031-02-28', d.recurrence, d.anchorDay)).toBe('2032-02-29')
  })

  it('ogni N giorni, settimane e mesi', () => {
    expect(nextOccurrence('2027-01-01', { unit: 'day', every: 10 }, 1)).toBe('2027-01-11')
    expect(nextOccurrence('2027-01-01', { unit: 'week', every: 2 }, 1)).toBe('2027-01-15')
    expect(nextOccurrence('2027-01-31', { unit: 'month', every: 3 }, 31)).toBe('2027-04-30')
  })

  it('elenca le occorrenze in un intervallo', () => {
    const d = fromInput(input({ date: '2027-01-05', recurrence: { unit: 'week', every: 1 } }))
    expect(occurrencesBetween(d, '2027-01-01', '2027-01-31')).toEqual([
      '2027-01-05',
      '2027-01-12',
      '2027-01-19',
      '2027-01-26'
    ])
    const once = fromInput(input({ date: '2027-01-05' }))
    expect(occurrencesBetween(once, '2027-02-01', '2027-02-28')).toEqual([])
  })

  it('riapri annulla l\'ultimo "Fatto"', () => {
    const d = markDone(monthly('2027-01-31'), 1)
    expect(reopen(d).date).toBe('2027-01-31')
    expect(reopen(d).history).toEqual([])
    const once = markDone(fromInput(input()), 5)
    expect(once.doneAt).toBe(5)
    expect(reopen(once).doneAt).toBeNull()
  })

  it('modificare la data aggiorna il giorno di riferimento, il resto no', () => {
    const d = monthly('2027-01-31')
    const same = fromInput(input({ date: '2027-01-31', title: 'Nuovo', recurrence: { unit: 'month', every: 1 } }), d)
    expect(same.anchorDay).toBe(31)
    const moved = fromInput(input({ date: '2027-01-15', recurrence: { unit: 'month', every: 1 } }), d)
    expect(moved.anchorDay).toBe(15)
  })
})

describe('urgenza e avvisi', () => {
  const today = '2027-01-10'
  const at = (date: string, leadDays: number | null = null): Deadline => fromInput(input({ date, leadDays }))

  it('classifica le scadenze', () => {
    expect(deadlineStatus(at('2027-01-09'), today, 3)).toBe('overdue')
    expect(deadlineStatus(at('2027-01-10'), today, 3)).toBe('today')
    expect(deadlineStatus(at('2027-01-13'), today, 3)).toBe('soon')
    expect(deadlineStatus(at('2027-01-15'), today, 3)).toBe('week')
    expect(deadlineStatus(at('2027-01-30'), today, 3)).toBe('later')
    expect(deadlineStatus(markDone(at('2027-01-09'), 1), today, 3)).toBe('done')
  })

  it('usa il preavviso della singola voce', () => {
    expect(needsAlert(at('2027-01-17', 7), today, 1)).toBe(true) // bollo: 7 giorni prima
    expect(needsAlert(at('2027-01-12', 1), today, 7)).toBe(false) // abbonamento: 1 giorno prima
    expect(needsAlert(at('2027-01-12'), today, 3)).toBe(true) // predefinito
  })

  it('posticipare sospende gli avvisi fino alla data scelta', () => {
    const d = snooze(at('2027-01-09'), '2027-01-11')
    expect(needsAlert(d, today, 3)).toBe(false)
    expect(needsAlert(d, '2027-01-11', 3)).toBe(true)
  })

  it('ordina per urgenza', () => {
    const items = [
      { ...at('2027-02-01'), id: 'later' },
      { ...markDone(at('2027-01-01'), 1), id: 'done' },
      { ...at('2027-01-08'), id: 'overdue' },
      { ...at('2027-01-10'), id: 'today' }
    ]
    expect(items.sort(compareByUrgency(today, 3)).map((i) => i.id)).toEqual(['overdue', 'today', 'later', 'done'])
  })
})
