import { join } from 'node:path'
import { readJson, writeJson } from './storage/localJson'
import { log } from './log'
import { toISODate } from '@shared/dates'
import { formatHHMM, isToday, shiftEnd, shiftSchema, type Shift, type ShiftOp, type ShiftState } from '@shared/shift'

interface Stored {
  shift: Shift | null
  /** Primo utilizzo del PC per giorno: { date, time }. */
  firstSeen: { date: string; time: string } | null
}

/**
 * Turno di lavoro di oggi (solo su questo PC: è il PC dell'ufficio).
 * Programma due avvisi: qualche minuto prima della fine e alla fine.
 */
export class ShiftService {
  private data: Stored = { shift: null, firstSeen: null }
  private timers: NodeJS.Timeout[] = []
  private listeners = new Set<() => void>()

  constructor(
    private readonly opts: {
      localDir: string
      config: () => { workMinutes: number; breakMinutes: number; remindBefore: number }
      remind: (minutesLeft: number, end: Date) => void
      ended: (end: Date) => void
      now?: () => Date
    }
  ) {}

  private get file() {
    return join(this.opts.localDir, 'shift.json')
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date()
  }

  async init(): Promise<void> {
    const stored = await readJson<Stored>(this.file, { shift: null, firstSeen: null })
    const parsed = shiftSchema.safeParse(stored.shift)
    this.data = { shift: parsed.success ? parsed.data : null, firstSeen: stored.firstSeen ?? null }
    await this.markActivity()
    this.schedule()
  }

  /** Da chiamare all'avvio e allo sblocco di Windows: ricorda il primo utilizzo della giornata. */
  async markActivity(): Promise<void> {
    const now = this.now()
    const today = toISODate(now)
    if (this.data.firstSeen?.date === today) return
    this.data.firstSeen = { date: today, time: formatHHMM(now.getHours() * 60 + now.getMinutes()) }
    await this.save()
    this.emit()
  }

  state(): ShiftState {
    const now = this.now()
    const today = toISODate(now)
    const shift = isToday(this.data.shift, today) ? this.data.shift : null
    const suggested =
      this.data.firstSeen?.date === today ? this.data.firstSeen.time : formatHHMM(now.getHours() * 60 + now.getMinutes())
    return { shift, suggestedArrival: suggested, endsAt: shift ? shiftEnd(shift).getTime() : null }
  }

  async apply(op: ShiftOp): Promise<boolean> {
    const today = toISODate(this.now())
    const cfg = this.opts.config()
    const current = isToday(this.data.shift, today) ? this.data.shift : null
    switch (op.op) {
      case 'start':
        this.data.shift = {
          date: today,
          arrival: op.arrival,
          workMinutes: cfg.workMinutes,
          breakMinutes: op.breakMinutes ?? cfg.breakMinutes
        }
        break
      case 'adjust':
        if (!current) return false
        this.data.shift = { ...current, arrival: op.arrival ?? current.arrival, breakMinutes: op.breakMinutes ?? current.breakMinutes }
        break
      case 'clear':
        this.data.shift = null
        break
    }
    await this.save()
    this.schedule()
    this.emit()
    return true
  }

  private schedule(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    const s = this.state().shift
    if (!s) return
    const end = shiftEnd(s)
    const now = this.now().getTime()
    const before = this.opts.config().remindBefore
    const remindAt = end.getTime() - before * 60_000
    if (before > 0 && remindAt > now) this.timers.push(setTimeout(() => this.opts.remind(before, end), remindAt - now))
    if (end.getTime() > now) {
      this.timers.push(
        setTimeout(() => {
          log.info('Fine turno')
          this.opts.ended(end)
          this.emit()
        }, end.getTime() - now)
      )
    }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Le impostazioni (durata, pausa, preavviso) sono cambiate: ricalcola gli avvisi. */
  reschedule(): void {
    this.schedule()
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }

  private save(): Promise<void> {
    return writeJson(this.file, this.data)
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t)
  }
}
