import { join } from 'node:path'
import { addDays, diffDays, toISODate, type ISODate } from '@shared/dates'
import type { BubbleAction } from '@shared/mascot'
import { readJson, writeJson } from './storage/localJson'
import { log } from './log'

/**
 * Un avviso da mostrare (scadenza, password, to-do…). Ogni modulo fornisce
 * una "sorgente" che, dato il giorno, restituisce gli avvisi dovuti.
 */
export interface AlertCandidate {
  /** Identifica la voce: al massimo un avviso al giorno per chiave. */
  key: string
  category: string
  /** Titolo della notifica di Windows. */
  title: string
  text: string
  actions: BubbleAction[]
  onAction: (actionId: string) => void
  onOpen: () => void
}

export type AlertSource = (today: ISODate) => AlertCandidate[]

export interface AlertDeps {
  localDir: string
  sources: AlertSource[]
  /** true se ora gli avvisi vanno trattenuti (pausa notifiche, non disturbare). */
  isQuiet: () => boolean
  toast: (title: string, body: string, onClick: () => void) => void
  bubble: (c: { category: string; text: string; actions: BubbleAction[]; onAction: (id: string) => void }) => void
  /** Testi per l'avviso riassuntivo quando gli avvisi sono tanti. */
  summary: (count: number) => { category: string; title: string; text: string; openLabel: string }
  openSummary: () => void
  now?: () => Date
}

/** Oltre questo numero di avvisi in una volta se ne mostra uno solo, riassuntivo. */
const MAX_SEPARATE = 3
const KEEP_LOG_DAYS = 60

/**
 * Motore degli avvisi: controlla le sorgenti all'avvio (così recupera gli
 * avvisi persi a PC spento), quando cambiano i dati e a intervalli regolari.
 * Il registro degli avvisi inviati è locale e garantisce un solo avviso al
 * giorno per voce, anche dopo un riavvio.
 */
export class AlertEngine {
  private sent: Record<string, ISODate> = {}
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly deps: AlertDeps) {}

  private get logFile(): string {
    return join(this.deps.localDir, 'alerts-sent.json')
  }

  async init(): Promise<void> {
    this.sent = await readJson<Record<string, ISODate>>(this.logFile, {})
  }

  /** Programma un controllo (le richieste ravvicinate vengono unite). */
  schedule(delayMs = 2000): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, delayMs)
  }

  async run(): Promise<number> {
    if (this.running || this.deps.isQuiet()) return 0
    this.running = true
    try {
      const today = toISODate(this.now())
      const due = this.deps.sources
        .flatMap((source) => {
          try {
            return source(today)
          } catch (err) {
            log.error('Sorgente di avvisi non riuscita', err)
            return []
          }
        })
        .filter((c) => this.sent[c.key] !== today)
      if (due.length === 0) return 0

      if (due.length > MAX_SEPARATE) {
        const s = this.deps.summary(due.length)
        this.deps.toast(s.title, s.text, this.deps.openSummary)
        this.deps.bubble({
          category: s.category,
          text: s.text,
          actions: [{ id: 'open', label: s.openLabel, primary: true }],
          onAction: () => this.deps.openSummary()
        })
      } else {
        for (const c of due) {
          this.deps.toast(c.title, c.text, c.onOpen)
          this.deps.bubble({ category: c.category, text: c.text, actions: c.actions, onAction: c.onAction })
        }
      }
      for (const c of due) this.sent[c.key] = today
      this.prune(today)
      await writeJson(this.logFile, this.sent)
      log.info(`Avvisi mostrati: ${due.length}`)
      return due.length
    } finally {
      this.running = false
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
  }

  private prune(today: ISODate): void {
    const oldest = addDays(today, -KEEP_LOG_DAYS)
    for (const [k, day] of Object.entries(this.sent)) {
      if (diffDays(oldest, day) < 0) delete this.sent[k]
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }
}
