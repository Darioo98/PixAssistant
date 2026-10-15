import { describe, expect, it } from 'vitest'
import { isCommandInput, parseCommand, suggestCommands } from '@shared/commands'

// mercoledì 14 ottobre 2026, 10:00
const now = new Date(2026, 9, 14, 10, 0)

describe('comandi rapidi della chat', () => {
  it('riconosce i comandi e lascia passare il resto all’AI', () => {
    expect(isCommandInput('/nota ciao')).toBe(true)
    expect(isCommandInput('//nota ciao')).toBe(false)
    expect(isCommandInput('ciao /nota')).toBe(false)
    expect(parseCommand('scrivi una mail', now)).toBeNull()
    expect(parseCommand('/boh x', now)).toMatchObject({ kind: 'error', code: 'unknown' })
  })

  it('note e to-do', () => {
    expect(parseCommand('/nota comprare il latte', now)).toEqual({ kind: 'note', text: 'comprare il latte' })
    expect(parseCommand('/todo domani chiamare Luca', now)).toEqual({ kind: 'todo', text: 'chiamare Luca', due: '2026-10-15' })
    expect(parseCommand('/todo 3 mele', now)).toEqual({ kind: 'todo', text: '3 mele', due: null })
    expect(parseCommand('/nota', now)).toMatchObject({ kind: 'error', code: 'missingText' })
  })

  it('promemoria con ora, data, giorno della settimana o "tra N minuti"', () => {
    expect(parseCommand('/promemoria 15:30 chiamare Marco', now)).toEqual({ kind: 'reminder', text: 'chiamare Marco', at: '2026-10-14T15:30' })
    expect(parseCommand('/promemoria 9:00 riunione', now)).toMatchObject({ at: '2026-10-15T09:00' }) // già passata: domani
    expect(parseCommand('/promemoria domani alle 8 palestra', now)).toMatchObject({ at: '2026-10-15T08:00' })
    expect(parseCommand('/ricorda venerdì 18.15 aperitivo', now)).toMatchObject({ at: '2026-10-16T18:15' })
    expect(parseCommand('/promemoria tra 20 min tè', now)).toMatchObject({ text: 'tè', at: '2026-10-14T10:20' })
    expect(parseCommand('/remind tomorrow 7:45 gym', now)).toMatchObject({ at: '2026-10-15T07:45' })
    expect(parseCommand('/promemoria chiamare', now)).toMatchObject({ kind: 'error', code: 'missingTime' })
    expect(parseCommand('/promemoria oggi 9:00 x', now)).toMatchObject({ kind: 'error', code: 'pastTime' })
  })

  it('scadenze con data', () => {
    expect(parseCommand('/scadenza 25/12 regali', now)).toEqual({ kind: 'deadline', title: 'regali', date: '2026-12-25' })
    expect(parseCommand('/scadenza 25.12 regali', now)).toMatchObject({ date: '2026-12-25' })
    expect(parseCommand('/scadenza 3/2 bollo', now)).toMatchObject({ date: '2027-02-03' }) // già passata: anno prossimo
    expect(parseCommand('/scadenza 31/02 x', now)).toMatchObject({ kind: 'error', code: 'missingDate' })
    expect(parseCommand('/scadenza bollo', now)).toMatchObject({ kind: 'error', code: 'missingDate' })
  })

  it('suggerisce i comandi mentre si scrive', () => {
    expect(suggestCommands('/pr', 'it').map((c) => c.name)).toEqual(['reminder'])
    expect(suggestCommands('/', 'it')).toHaveLength(6)
    expect(suggestCommands('/nota x', 'it')).toEqual([])
  })
})
