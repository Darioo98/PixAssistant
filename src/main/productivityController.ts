import type { TFunction } from 'i18next'
import { NotesService, ReminderService, TimerService, TodoService } from './productivity'
import type { Codec, DeviceInfo } from './storage/collection'
import type { AlertSource } from './alerts'
import type { BubbleRequest } from './mascot'
import { noteOpSchema, reminderOpSchema, timerOpSchema, todoOpSchema, nextPomodoro, type PomodoroConfig } from '@shared/productivity'
import type { DataCollection, DataResult } from '@shared/ipc'
import type { Settings } from '@shared/settings'

export interface ProductivityDeps {
  dataDir: string
  localDir: string
  device: DeviceInfo
  codec: (collection: string) => Codec
  onError: (err: unknown, file?: string) => void
  settings: () => Settings
  t: () => TFunction
  isQuiet: () => boolean
  toast: (title: string, body: string, onClick: () => void) => void
  bubble: (req: BubbleRequest) => void
  celebrate: () => void
  openPanel: (tab: 'notes' | 'timers') => void
  send: (collection: DataCollection, items: unknown) => void
}

/** Note, to-do, promemoria e timer: servizi, avvisi e IPC. */
export class ProductivityController {
  readonly notes: NotesService
  readonly todos: TodoService
  readonly reminders: ReminderService
  readonly timers: TimerService

  constructor(private readonly deps: ProductivityDeps) {
    const storeDeps = { dataDir: deps.dataDir, device: deps.device, codec: deps.codec, onError: deps.onError }
    this.notes = new NotesService(storeDeps)
    this.todos = new TodoService(storeDeps, deps.celebrate)
    this.reminders = new ReminderService(storeDeps, { isQuiet: deps.isQuiet, fire: (r) => this.fireReminder(r) })
    this.timers = new TimerService(deps.localDir, {
      pomodoro: () => this.pomodoro(),
      labels: () => {
        const t = deps.t()
        return { work: t('timers.phase.work'), short: t('timers.phase.short'), long: t('timers.phase.long'), timer: t('timers.timer') }
      },
      finished: (timer) => this.timerFinished(timer.id, timer.kind, timer.label, timer.phase, timer.completedWork)
    })

    this.notes.store.onChange(() => deps.send('notes', this.notes.list()))
    this.todos.store.onChange(() => deps.send('todos', this.todos.list()))
    this.reminders.store.onChange(() => deps.send('reminders', this.reminders.list()))
    this.timers.onChange(() => deps.send('timers', this.timers.list()))
  }

  async load(): Promise<void> {
    await Promise.all([this.notes.store.load(), this.todos.store.load(), this.reminders.store.load()])
  }

  /** Da chiamare quando notifiche e mascotte sono pronte: riprende i timer e controlla i promemoria. */
  async start(): Promise<void> {
    await this.timers.init()
    // Promemoria scaduti a PC spento: si mostrano una volta all'avvio.
    setTimeout(() => this.reminders.check(), 6000)
  }

  private pomodoro(): PomodoroConfig {
    const s = this.deps.settings()
    return { work: s.pomoWork, short: s.pomoShort, long: s.pomoLong, longEvery: s.pomoLongEvery }
  }

  list(collection: DataCollection): unknown {
    switch (collection) {
      case 'notes':
        return this.notes.list()
      case 'todos':
        return this.todos.list()
      case 'reminders':
        return this.reminders.list()
      case 'timers':
        return this.timers.list()
    }
  }

  apply(collection: DataCollection, op: unknown): DataResult {
    const result = (r: string | boolean): DataResult => (typeof r === 'string' ? { ok: true, id: r } : { ok: r })
    switch (collection) {
      case 'notes': {
        const p = noteOpSchema.safeParse(op)
        return p.success ? result(this.notes.apply(p.data)) : { ok: false }
      }
      case 'todos': {
        const p = todoOpSchema.safeParse(op)
        return p.success ? result(this.todos.apply(p.data)) : { ok: false }
      }
      case 'reminders': {
        const p = reminderOpSchema.safeParse(op)
        return p.success ? result(this.reminders.apply(p.data)) : { ok: false }
      }
      case 'timers': {
        const p = timerOpSchema.safeParse(op)
        return p.success ? result(this.timers.apply(p.data)) : { ok: false }
      }
    }
  }

  /** Avvisi dei to-do con data (uno al giorno, come le scadenze). */
  alertSource(): AlertSource {
    return (today) => {
      const t = this.deps.t()
      return this.todos.dueToday(today).map((todo) => ({
        key: `todo:${todo.id}`,
        category: t('todos.category'),
        title: todo.text,
        text: todo.due === today ? t('todos.alert.today', { text: todo.text }) : t('todos.alert.overdue', { text: todo.text }),
        actions: [
          { id: 'tomorrow', label: t('alerts.tomorrow') },
          { id: 'done', label: t('alerts.done'), primary: true }
        ],
        onOpen: () => this.deps.openPanel('notes'),
        onAction: (id) => {
          if (id === 'done') this.todos.apply({ op: 'toggle', id: todo.id })
          else this.todos.postpone(todo.id, today)
        }
      }))
    }
  }

  private fireReminder(r: { id: string; text: string }): void {
    const t = this.deps.t()
    this.deps.toast(t('reminders.category'), r.text, () => this.deps.openPanel('timers'))
    this.deps.bubble({
      category: t('reminders.category'),
      text: r.text,
      actions: [
        { id: 'snooze', label: t('reminders.snooze10') },
        { id: 'ok', label: t('reminders.ok'), primary: true }
      ],
      onOutcome: (o) => {
        if (o.kind === 'action' && o.actionId === 'snooze') this.reminders.snooze(r.id, 10)
      }
    })
  }

  private timerFinished(id: string, kind: 'pomodoro' | 'custom', label: string, phase?: 'work' | 'short' | 'long', completedWork = 0): void {
    const t = this.deps.t()
    if (kind === 'custom' || !phase) {
      const text = t('timers.finished', { label })
      this.deps.toast(t('timers.category'), text, () => this.deps.openPanel('timers'))
      this.deps.bubble({ category: t('timers.category'), text, actions: [{ id: 'ok', label: t('reminders.ok'), primary: true }], alert: false })
      return
    }
    const next = nextPomodoro(phase, completedWork, this.pomodoro()).phase
    const text = phase === 'work' ? t('timers.pomodoroBreak', { phase: t(`timers.phase.${next}`) }) : t('timers.pomodoroWork')
    this.deps.toast(t('timers.pomodoro'), text, () => this.deps.openPanel('timers'))
    this.deps.bubble({
      category: t('timers.pomodoro'),
      text,
      alert: false,
      actions: [
        { id: 'stop', label: t('timers.stop') },
        { id: 'next', label: t('timers.startPhase', { phase: t(`timers.phase.${next}`) }), primary: true }
      ],
      onOutcome: (o) => {
        if (o.kind !== 'action') return
        this.timers.apply(o.actionId === 'next' ? { op: 'next', id } : { op: 'cancel', id })
      }
    })
    if (phase === 'work') this.deps.celebrate()
  }

  async flush(): Promise<void> {
    await Promise.all([this.notes.store.flush(), this.todos.store.flush(), this.reminders.store.flush(), this.timers.flush()])
  }

  dispose(): void {
    this.reminders.dispose()
    this.timers.dispose()
  }
}
