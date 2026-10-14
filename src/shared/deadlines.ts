import { z } from 'zod'
import type { SyncItem } from './sync'
import { addDays, addMonths, diffDays, isValidISODate, parseISODate, type ISODate } from './dates'

/** Scadenze: modello, ricorrenze e urgenza (logica pura, testata). */

export const isoDate = z.string().refine(isValidISODate, 'data non valida')

export const RECURRENCE_UNITS = ['none', 'day', 'week', 'month', 'year'] as const
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number]

export const recurrenceSchema = z.object({
  unit: z.enum(RECURRENCE_UNITS),
  every: z.number().int().min(1).max(999)
})
export type Recurrence = z.infer<typeof recurrenceSchema>

export const historyEntrySchema = z.object({ date: isoDate, doneAt: z.number() })

export const deadlineSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** Prossima occorrenza (o data unica). */
  date: isoDate,
  /** Giorno del mese originale, per le ricorrenze mensili/annuali (31 → 30 → 31). */
  anchorDay: z.number().int().min(1).max(31),
  recurrence: recurrenceSchema,
  /** Giorni di preavviso per questa voce; null = valore predefinito delle impostazioni. */
  leadDays: z.number().int().min(0).max(365).nullable(),
  category: z.string().trim().max(60),
  notes: z.string().max(5000),
  /** Solo per le scadenze non ricorrenti: quando è stata segnata come fatta. */
  doneAt: z.number().nullable(),
  /** Avvisi posticipati fino a questa data (la scadenza non cambia). */
  snoozedUntil: isoDate.nullable(),
  /** Occorrenze completate delle scadenze ricorrenti (le più recenti per prime). */
  history: z.array(historyEntrySchema).max(50)
})
export type Deadline = z.infer<typeof deadlineSchema>

/** Dati modificabili dall'utente nel form. */
export const deadlineInputSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  title: deadlineSchema.shape.title,
  date: isoDate,
  recurrence: recurrenceSchema,
  leadDays: deadlineSchema.shape.leadDays,
  category: deadlineSchema.shape.category,
  notes: deadlineSchema.shape.notes
})
export type DeadlineInput = z.infer<typeof deadlineInputSchema>

export const isRecurring = (d: Pick<Deadline, 'recurrence'>) => d.recurrence.unit !== 'none'

/** Occorrenza successiva a `date` secondo la ricorrenza. */
export function nextOccurrence(date: ISODate, rec: Recurrence, anchorDay: number): ISODate {
  switch (rec.unit) {
    case 'day':
      return addDays(date, rec.every)
    case 'week':
      return addDays(date, 7 * rec.every)
    case 'month':
      return addMonths(date, rec.every, anchorDay)
    case 'year':
      return addMonths(date, 12 * rec.every, anchorDay)
    case 'none':
      return date
  }
}

/** Occorrenze comprese tra `from` e `to` (incluse), a partire dalla prossima. */
export function occurrencesBetween(d: Deadline, from: ISODate, to: ISODate, limit = 400): ISODate[] {
  const out: ISODate[] = []
  let cur = d.date
  for (let i = 0; i < limit && diffDays(cur, to) >= 0; i++) {
    if (diffDays(from, cur) >= 0) out.push(cur)
    if (!isRecurring(d)) break
    cur = nextOccurrence(cur, d.recurrence, d.anchorDay)
  }
  return out
}

export type DeadlineStatus = 'done' | 'overdue' | 'today' | 'soon' | 'week' | 'later'

export function effectiveLead(d: Pick<Deadline, 'leadDays'>, defaultLead: number): number {
  return d.leadDays ?? defaultLead
}

export function deadlineStatus(d: Deadline, today: ISODate, defaultLead: number): DeadlineStatus {
  if (!isRecurring(d) && d.doneAt != null) return 'done'
  const days = diffDays(today, d.date)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= effectiveLead(d, defaultLead)) return 'soon'
  if (days <= 7) return 'week'
  return 'later'
}

const STATUS_RANK: Record<DeadlineStatus, number> = { overdue: 0, today: 1, soon: 2, week: 3, later: 4, done: 5 }

/** Ordine per urgenza: scadute, oggi, in preavviso, settimana, più avanti, fatte. */
export function compareByUrgency(today: ISODate, defaultLead: number) {
  return (a: Deadline & { id: string }, b: Deadline & { id: string }) =>
    STATUS_RANK[deadlineStatus(a, today, defaultLead)] - STATUS_RANK[deadlineStatus(b, today, defaultLead)] ||
    diffDays(b.date, a.date) ||
    a.title.localeCompare(b.title)
}

/** Va mostrato un avviso oggi? (dentro il preavviso, non fatta, non posticipata) */
export function needsAlert(d: Deadline, today: ISODate, defaultLead: number): boolean {
  const s = deadlineStatus(d, today, defaultLead)
  if (s !== 'overdue' && s !== 'today' && s !== 'soon') return false
  return !(d.snoozedUntil && diffDays(today, d.snoozedUntil) > 0)
}

// ---- Operazioni (pure: restituiscono la nuova versione della voce) ----

export function fromInput(input: DeadlineInput, prev?: Deadline): Deadline {
  const dateChanged = !prev || prev.date !== input.date
  return {
    title: input.title,
    date: input.date,
    anchorDay: dateChanged ? parseISODate(input.date).d : prev.anchorDay,
    recurrence: input.recurrence,
    leadDays: input.leadDays,
    category: input.category,
    notes: input.notes,
    doneAt: prev?.doneAt ?? null,
    snoozedUntil: dateChanged ? null : (prev?.snoozedUntil ?? null),
    history: prev?.history ?? []
  }
}

/** "Fatto": le ricorrenti passano alla prossima occorrenza tenendo lo storico. */
export function markDone(d: Deadline, now: number): Deadline {
  if (!isRecurring(d)) return { ...d, doneAt: now, snoozedUntil: null }
  return {
    ...d,
    history: [{ date: d.date, doneAt: now }, ...d.history].slice(0, 50),
    date: nextOccurrence(d.date, d.recurrence, d.anchorDay),
    snoozedUntil: null
  }
}

/** Riapre: annulla l'ultimo "Fatto". */
export function reopen(d: Deadline): Deadline {
  if (!isRecurring(d)) return { ...d, doneAt: null }
  const [last, ...rest] = d.history
  if (!last) return d
  return { ...d, date: last.date, history: rest }
}

export function snooze(d: Deadline, until: ISODate): Deadline {
  return { ...d, snoozedUntil: until }
}

/** Voce con i metadati di sincronizzazione (id, revisione…), come arriva al renderer. */
export type DeadlineItem = SyncItem<Deadline>

/** Operazioni richieste dal renderer, validate nel processo main. */
export const deadlineOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('save'), input: deadlineInputSchema }),
  z.object({ op: z.literal('remove'), id: z.string().min(1).max(200) }),
  z.object({ op: z.literal('done'), id: z.string().min(1).max(200) }),
  z.object({ op: z.literal('reopen'), id: z.string().min(1).max(200) }),
  z.object({ op: z.literal('snooze'), id: z.string().min(1).max(200), until: isoDate })
])
export type DeadlineOp = z.infer<typeof deadlineOpSchema>
