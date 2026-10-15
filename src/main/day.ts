import { join } from 'node:path'
import { readJson, writeJson } from './storage/localJson'
import { toISODate, type ISODate } from '@shared/dates'
import { SUMMARY_FROM_HOUR } from '@shared/day'
import { log } from './log'

interface DayFile {
  date: ISODate
  /** Cicli di lavoro del Pomodoro completati oggi. */
  cycles: number
  /** Riepilogo del mattino già mostrato oggi. */
  summaryShown: boolean
}

/** Stato della giornata su questo PC (non sincronizzato): cicli di focus e riepilogo. */
export class DayService {
  private data: DayFile
  /** Scritture in fila: mai due salvataggi contemporanei dello stesso file. */
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly localDir: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.data = { date: toISODate(this.now()), cycles: 0, summaryShown: false }
  }

  private get file() {
    return join(this.localDir, 'day.json')
  }

  async init(): Promise<void> {
    const saved = await readJson<Partial<DayFile>>(this.file, {})
    if (saved.date === toISODate(this.now())) {
      this.data = { date: saved.date, cycles: Number(saved.cycles) || 0, summaryShown: saved.summaryShown === true }
    }
  }

  /** Il giorno è cambiato dall'ultima volta: si riparte da zero. */
  private current(): DayFile {
    const today = toISODate(this.now())
    if (this.data.date !== today) this.data = { date: today, cycles: 0, summaryShown: false }
    return this.data
  }

  cyclesToday(): number {
    return this.current().cycles
  }

  addCycle(): number {
    const d = this.current()
    d.cycles++
    this.save()
    return d.cycles
  }

  summaryDue(): boolean {
    return !this.current().summaryShown && this.now().getHours() >= SUMMARY_FROM_HOUR
  }

  markSummary(): void {
    this.current().summaryShown = true
    this.save()
  }

  flush(): Promise<void> {
    return this.writing
  }

  private save(): void {
    const snapshot = { ...this.data }
    this.writing = this.writing
      .then(() => writeJson(this.file, snapshot))
      .catch((err) => log.warn('Salvataggio della giornata non riuscito', err))
  }
}
