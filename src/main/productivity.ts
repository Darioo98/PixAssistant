import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CollectionStore, type Codec, type DeviceInfo } from './storage/collection'
import { readJson, writeJson } from './storage/localJson'
import { log } from './log'
import {
  afterFired,
  compareTodos,
  formatLocal,
  isTodoForToday,
  nextPomodoro,
  noteSchema,
  parseLocal,
  phaseMinutes,
  reminderDueAt,
  reminderSchema,
  todoSchema,
  type Note,
  type NoteOp,
  type PomodoroConfig,
  type Reminder,
  type ReminderItem,
  type ReminderOp,
  type TimerOp,
  type TimerView,
  type Todo,
  type TodoItem,
  type TodoOp
} from '@shared/productivity'
import { addDays, type ISODate } from '@shared/dates'

interface StoreDeps {
  dataDir: string
  device: DeviceInfo
  codec: (collection: string) => Codec
  onError: (err: unknown, file?: string) => void
}

function makeStore<T extends object>(deps: StoreDeps, name: string, schema: import('zod').ZodType<T>) {
  return new CollectionStore<T>({ dir: join(deps.dataDir, name), name, device: deps.device, schema, codec: deps.codec(name), onError: deps.onError })
}

// ======================= Note =======================

export class NotesService {
  readonly store: CollectionStore<Note>
  constructor(deps: StoreDeps) {
    this.store = makeStore(deps, 'notes', noteSchema)
  }
  list() {
    return this.store.list().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }
  apply(op: NoteOp): string | boolean {
    if (op.op === 'remove') return this.store.remove(op.id)
    const prev = op.id ? this.store.get(op.id) : undefined
    // Salvataggio automatico: niente nuova revisione se non è cambiato nulla.
    if (prev && prev.title === op.note.title && prev.body === op.note.body && prev.pinned === op.note.pinned) return prev.id
    return this.store.put({ ...op.note, id: op.id }).id
  }
}

// ======================= To-do =======================

export class TodoService {
  readonly store: CollectionStore<Todo>
  constructor(
    deps: StoreDeps,
    private readonly onDone: () => void
  ) {
    this.store = makeStore(deps, 'todos', todoSchema)
  }
  list(): TodoItem[] {
    return this.store.list().sort(compareTodos)
  }
  apply(op: TodoOp): string | boolean {
    switch (op.op) {
      case 'save': {
        const prev = op.id ? this.store.get(op.id) : undefined
        return this.store.put({ done: prev?.done ?? false, doneAt: prev?.doneAt ?? null, ...op.todo, id: op.id }).id
      }
      case 'toggle': {
        const t = this.store.get(op.id)
        if (!t) return false
        const done = !t.done
        this.store.put({ ...strip(t), done, doneAt: done ? Date.now() : null, id: op.id })
        if (done) this.onDone()
        return true
      }
      case 'remove':
        return this.store.remove(op.id)
      case 'clearDone':
        for (const t of this.store.list()) if (t.done) this.store.remove(t.id)
        return true
    }
  }
  /** Rimanda a domani (dall'avviso). */
  postpone(id: string, today: ISODate): void {
    const t = this.store.get(id)
    if (t) this.store.put({ ...strip(t), due: addDays(today, 1), today: false, id })
  }
  dueToday(today: ISODate): TodoItem[] {
    return this.list().filter((t) => t.due !== null && isTodoForToday(t, today))
  }
}

function strip<T extends object>(item: T): T {
  const { id: _i, createdAt: _c, updatedAt: _u, updatedBy: _b, rev: _r, hist: _h, deletedAt: _d, ...rest } = item as Record<string, unknown>
  return rest as T
}

// ======================= Promemoria =======================

const MAX_SLEEP_MS = 6 * 3_600_000
const QUIET_RETRY_MS = 5 * 60_000

/**
 * Promemoria a orario con un pianificatore preciso: un solo timer verso il
 * prossimo promemoria (al massimo 6 ore, poi ricalcola). All'avvio mostra
 * quelli scaduti a PC spento, una volta sola.
 */
export class ReminderService {
  readonly store: CollectionStore<Reminder>
  private timer: NodeJS.Timeout | null = null

  constructor(
    deps: StoreDeps,
    private readonly opts: {
      isQuiet: () => boolean
      fire: (r: ReminderItem) => void
      now?: () => number
    }
  ) {
    this.store = makeStore(deps, 'reminders', reminderSchema)
    this.store.onChange(() => this.schedule())
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }

  list(): ReminderItem[] {
    return this.store.list().sort((a, b) => (reminderDueAt(a) ?? Infinity) - (reminderDueAt(b) ?? Infinity))
  }

  apply(op: ReminderOp): string | boolean {
    switch (op.op) {
      case 'save': {
        const day = Number(op.at.slice(8, 10))
        return this.store.put({ text: op.text, at: op.at, repeat: op.repeat, anchorDay: day, snoozedUntil: null, done: false, id: op.id }).id
      }
      case 'remove':
        return this.store.remove(op.id)
      case 'snooze':
        return this.snooze(op.id, op.minutes)
    }
  }

  snooze(id: string, minutes: number): boolean {
    const r = this.store.get(id)
    if (!r) return false
    this.store.put({ ...strip(r), done: false, snoozedUntil: this.now() + minutes * 60_000, id })
    return true
  }

  /** Mostra i promemoria scaduti e programma il prossimo controllo. */
  check(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const now = this.now()
    if (this.opts.isQuiet()) {
      this.timer = setTimeout(() => this.check(), QUIET_RETRY_MS)
      return
    }
    for (const r of this.store.list()) {
      const due = reminderDueAt(r)
      if (due === null || due > now) continue
      try {
        this.opts.fire(r)
      } catch (err) {
        log.error('Promemoria non mostrato', err)
      }
      this.store.put({ ...strip(afterFired(r, now)), id: r.id })
    }
    this.schedule()
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    const now = this.now()
    const next = Math.min(...this.store.list().map((r) => reminderDueAt(r) ?? Infinity))
    if (!Number.isFinite(next)) return
    this.timer = setTimeout(() => this.check(), Math.max(500, Math.min(next - now, MAX_SLEEP_MS)))
  }

  todayList(today: ISODate): ReminderItem[] {
    return this.list().filter((r) => !r.done && r.at.startsWith(today))
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
  }
}

// ======================= Timer =======================

interface StoredTimer extends TimerView {}

/**
 * Timer e Pomodoro (solo su questo PC). Lo stato si salva in locale con l'ora
 * di fine, così un riavvio dell'app non perde i timer in corso.
 */
export class TimerService {
  private timers = new Map<string, StoredTimer>()
  private handles = new Map<string, NodeJS.Timeout>()
  private listeners = new Set<() => void>()
  /** Scritture in fila: mai due salvataggi contemporanei dello stesso file. */
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly localDir: string,
    private readonly opts: {
      pomodoro: () => PomodoroConfig
      labels: () => Record<'work' | 'short' | 'long' | 'timer', string>
      finished: (t: TimerView) => void
    }
  ) {}

  private get file() {
    return join(this.localDir, 'timers.json')
  }

  async init(): Promise<void> {
    const saved = await readJson<StoredTimer[]>(this.file, [])
    for (const t of Array.isArray(saved) ? saved : []) {
      if (t && typeof t.id === 'string' && t.state !== 'done') this.timers.set(t.id, t)
    }
    for (const t of this.timers.values()) if (t.state === 'running') this.arm(t)
  }

  list(): TimerView[] {
    return [...this.timers.values()]
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  apply(op: TimerOp): string | boolean {
    const now = Date.now()
    switch (op.op) {
      case 'startPomodoro': {
        const minutes = phaseMinutes('work', this.opts.pomodoro())
        return this.start({ kind: 'pomodoro', label: this.opts.labels().work, phase: 'work', completedWork: 0, durationMs: minutes * 60_000 })
      }
      case 'startCustom':
        return this.start({
          kind: 'custom',
          label: op.label.trim() || this.opts.labels().timer,
          completedWork: 0,
          durationMs: Math.round(op.minutes * 60_000)
        })
      case 'pause':
        return this.update(op.id, (t) => (t.state === 'running' ? { ...t, state: 'paused', remainingMs: Math.max(0, (t.endsAt ?? now) - now), endsAt: null } : t))
      case 'resume':
        return this.update(op.id, (t) => (t.state === 'paused' ? { ...t, state: 'running', endsAt: now + t.remainingMs } : t))
      case 'next':
        return this.update(op.id, (t) => this.advance(t, now))
      case 'cancel': {
        const ok = this.timers.delete(op.id)
        this.disarm(op.id)
        this.changed()
        return ok
      }
    }
  }

  private start(t: Omit<TimerView, 'id' | 'state' | 'endsAt' | 'remainingMs'>): string {
    const id = randomUUID()
    const timer: StoredTimer = { ...t, id, state: 'running', endsAt: Date.now() + t.durationMs, remainingMs: t.durationMs }
    this.timers.set(id, timer)
    this.arm(timer)
    this.changed()
    return id
  }

  /** Pomodoro: passa alla fase successiva e la avvia. */
  private advance(t: StoredTimer, now: number): StoredTimer {
    if (t.kind !== 'pomodoro' || !t.phase) return t
    const cfg = this.opts.pomodoro()
    const next = nextPomodoro(t.phase, t.completedWork, cfg)
    const durationMs = phaseMinutes(next.phase, cfg) * 60_000
    return { ...t, phase: next.phase, completedWork: next.completedWork, label: this.opts.labels()[next.phase], durationMs, state: 'running', endsAt: now + durationMs, remainingMs: durationMs }
  }

  private update(id: string, fn: (t: StoredTimer) => StoredTimer): boolean {
    const t = this.timers.get(id)
    if (!t) return false
    const next = fn(t)
    this.timers.set(id, next)
    if (next.state === 'running') this.arm(next)
    else this.disarm(id)
    this.changed()
    return true
  }

  private arm(t: StoredTimer): void {
    this.disarm(t.id)
    const delay = Math.max(0, (t.endsAt ?? Date.now()) - Date.now())
    // setTimeout accetta al massimo ~24,8 giorni: i timer qui durano al massimo 24 ore.
    this.handles.set(t.id, setTimeout(() => this.finish(t.id), delay))
  }

  private disarm(id: string): void {
    const h = this.handles.get(id)
    if (h) clearTimeout(h)
    this.handles.delete(id)
  }

  private finish(id: string): void {
    const t = this.timers.get(id)
    if (!t || t.state !== 'running') return
    this.handles.delete(id)
    // Il Pomodoro aspetta che tu avvii la fase successiva; il timer semplice si chiude.
    const ended: StoredTimer = { ...t, state: t.kind === 'pomodoro' ? 'waiting' : 'done', endsAt: null, remainingMs: 0 }
    if (ended.state === 'done') this.timers.delete(id)
    else this.timers.set(id, ended)
    this.changed()
    this.opts.finished(ended)
  }

  private changed(): void {
    const snapshot = [...this.timers.values()]
    this.writing = this.writing
      .then(() => writeJson(this.file, snapshot))
      .catch((err) => log.warn('Salvataggio timer non riuscito', err))
    for (const cb of this.listeners) cb()
  }

  flush(): Promise<void> {
    return this.writing
  }

  dispose(): void {
    for (const h of this.handles.values()) clearTimeout(h)
  }
}

