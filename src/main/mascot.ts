import { randomUUID } from 'node:crypto'
import {
  NIGHT,
  SLEEP_AFTER_IDLE_S,
  inTimeRange,
  resolveMood,
  type Bubble,
  type BubbleOutcome,
  type MascotState,
  type Mood
} from '@shared/mascot'
import type { Settings } from '@shared/settings'

export interface BubbleRequest {
  category: string
  text: string
  actions?: Bubble['actions']
  alert?: boolean
  /** Durata del fumetto (ms); predefinita dalle impostazioni. */
  timeoutMs?: number
  /** Chiamata alla chiusura del fumetto: azione scelta, chiusura manuale o scadenza. */
  onOutcome?: (outcome: BubbleOutcome) => void
}

interface QueuedBubble {
  bubble: Bubble
  onOutcome?: (outcome: BubbleOutcome) => void
}

export interface MascotDeps {
  settings: () => Settings
  /** Secondi di inattività del PC (powerMonitor). */
  idleSeconds: () => number
  /** Se false (mascotte nascosta, schermo intero…) i fumetti non vengono mostrati. */
  canShowBubbles: () => boolean
  onChange: (state: MascotState) => void
  /** Pomodoro di lavoro in corso. */
  focus?: () => boolean
  /** Scadenze vicine o to-do in ritardo. */
  tension?: () => boolean
  now?: () => Date
}

const TRANSIENT_MS: Partial<Record<Mood, number>> = { happy: 2400, greet: 1500, sleep: 5000, think: 5000 }
const GAP_BETWEEN_BUBBLES_MS = 600
const TICK_MS = 60_000

/**
 * Cervello di Pix: decide l'umore e gestisce la coda dei fumetti
 * (al massimo uno visibile, gli altri in attesa).
 */
export class MascotService {
  private queue: QueuedBubble[] = []
  private current: QueuedBubble | null = null
  private thinking = false
  private transient: Mood | null = null
  private transientTimer: NodeJS.Timeout | null = null
  private safetyTimer: NodeJS.Timeout | null = null
  private nextTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout
  private asleep = false
  private last: string = ''

  constructor(private readonly deps: MascotDeps) {
    this.asleep = this.computeAsleep()
    this.tickTimer = setInterval(() => {
      this.refreshSleep()
      this.emit() // tensione e focus dipendono dall'ora
    }, TICK_MS)
  }

  state(): MascotState {
    return {
      mood: resolveMood({
        bubbleAlert: Boolean(this.current?.bubble.alert),
        thinking: this.thinking,
        transient: this.transient,
        asleep: this.asleep,
        focus: this.deps.focus?.() ?? false
      }),
      bubble: this.current?.bubble ?? null,
      queued: this.queue.length,
      spotlight: this.transient !== null,
      focus: this.deps.focus?.() ?? false,
      tension: this.deps.tension?.() ?? false
    }
  }

  /**
   * Mette in coda un fumetto. Restituisce l'id, oppure null se in questo momento
   * i fumetti sono silenziati (non disturbare, pausa notifiche, mascotte nascosta):
   * in quel caso l'avviso resta comunque visibile in Home.
   */
  notify(req: BubbleRequest): string | null {
    if (this.muted()) return null
    const bubble: Bubble = {
      id: randomUUID(),
      category: req.category,
      time: this.now().getTime(),
      text: req.text,
      actions: req.actions ?? [],
      alert: req.alert ?? true,
      timeoutMs: req.timeoutMs ?? this.deps.settings().bubbleSeconds * 1000
    }
    this.queue.push({ bubble, onOutcome: req.onOutcome })
    if (!this.current && !this.nextTimer) this.showNext()
    else this.emit()
    return bubble.id
  }

  /** Esito di un fumetto, riferito dal renderer. */
  resolveBubble(id: string, outcome: BubbleOutcome): void {
    if (!this.current || this.current.bubble.id !== id) return
    const done = this.current
    this.current = null
    if (this.safetyTimer) clearTimeout(this.safetyTimer)
    try {
      done.onOutcome?.(outcome)
    } finally {
      this.emit()
      this.nextTimer = setTimeout(() => {
        this.nextTimer = null
        this.showNext()
      }, GAP_BETWEEN_BUBBLES_MS)
    }
  }

  setThinking(value: boolean): void {
    if (this.thinking === value) return
    this.thinking = value
    this.emit()
  }

  /** Stato momentaneo (festeggia, saluta…), poi torna allo stato di base. */
  flash(mood: Mood, ms = TRANSIENT_MS[mood] ?? 2000): void {
    if (this.deps.settings().animations === 'off' && mood === 'greet') return
    this.transient = mood
    if (this.transientTimer) clearTimeout(this.transientTimer)
    this.transientTimer = setTimeout(() => {
      this.transient = null
      this.emit()
    }, ms)
    this.emit()
  }

  celebrate(): void {
    this.flash('happy')
  }

  /** Ricalcola lo stato (es. è cambiato il focus o una scadenza). */
  refresh(): void {
    this.emit()
  }

  /** Va chiamato quando l'utente interagisce: Pix si sveglia subito. */
  wake(): void {
    this.refreshSleep(true)
  }

  refreshSleep(userActive = false): void {
    const next = userActive ? this.isNight() : this.computeAsleep()
    if (next !== this.asleep) {
      this.asleep = next
      this.emit()
    }
  }

  dispose(): void {
    clearInterval(this.tickTimer)
    for (const t of [this.transientTimer, this.safetyTimer, this.nextTimer]) if (t) clearTimeout(t)
  }

  private showNext(): void {
    while (this.queue.length && this.muted()) {
      // Silenziati nel frattempo: chiudiamo gli avvisi in coda senza mostrarli.
      this.queue.shift()?.onOutcome?.({ kind: 'dismiss' })
    }
    const next = this.queue.shift()
    if (!next) {
      this.emit()
      return
    }
    next.bubble.time = Math.min(next.bubble.time, this.now().getTime())
    this.current = next
    // Rete di sicurezza: se il renderer non risponde, il fumetto si chiude comunque.
    this.safetyTimer = setTimeout(
      () => this.resolveBubble(next.bubble.id, { kind: 'timeout' }),
      next.bubble.timeoutMs * 3 + 5000
    )
    this.emit()
  }

  private muted(): boolean {
    const s = this.deps.settings()
    if (s.notificationsPaused || !this.deps.canShowBubbles() || this.deps.focus?.()) return true
    return s.dndEnabled && inTimeRange(this.now(), s.dndFrom, s.dndTo)
  }

  private isNight(): boolean {
    const s = this.deps.settings()
    return s.dndEnabled ? inTimeRange(this.now(), s.dndFrom, s.dndTo) : inTimeRange(this.now(), NIGHT.from, NIGHT.to)
  }

  private computeAsleep(): boolean {
    return this.isNight() || this.deps.idleSeconds() >= SLEEP_AFTER_IDLE_S
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private emit(): void {
    const state = this.state()
    const key = JSON.stringify(state)
    if (key === this.last) return
    this.last = key
    this.deps.onChange(state)
  }
}
