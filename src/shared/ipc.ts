import type { Settings, SettingsPatch } from './settings'
import type { Lang } from './i18n'
import type { BubbleOutcome, MascotState } from './mascot'
import type { DeadlineItem, DeadlineOp } from './deadlines'
import type { VaultData, VaultOp, VaultOpResult, VaultStatus } from './vault'
import type { ChatOp, ChatOpResult, ChatState, ChatStreamEvent, ConversationItem } from './chat'
import type { ClipOp, ClipState, LinkOp, LinkView, WeatherState } from './extras'
import type { MaintenanceOp, MaintenanceResult, MaintenanceState } from './maintenance'
import type { ShiftOp, ShiftState } from './shift'
import type { NoteItem, NoteOp, ReminderItem, ReminderOp, TimerOp, TimerView, TodoItem, TodoOp } from './productivity'

export const TABS = [
  'home',
  'deadlines',
  'vault',
  'chat',
  'notes',
  'timers',
  'clipboard',
  'links',
  'settings'
] as const
export type TabId = (typeof TABS)[number]

export type DataDirKind = 'personal' | 'business' | 'custom' | 'local'

export interface DataDirInfo {
  path: string
  kind: DataDirKind
}

export interface UiState {
  panelOpen: boolean
  tab: TabId
  lang: Lang
  settings: Settings
  dataDir: DataDirInfo
  /** In sviluppo l'avvio automatico non viene registrato. */
  autostartAvailable: boolean
  mascot: MascotState
  vault: VaultStatus
  /** Azione richiesta da un avviso (es. "Genera" una nuova password), da eseguire all'apertura. */
  intent: UiIntent | null
}

/** Collezioni semplici con la stessa API (elenco, aggiornamenti, operazioni). */
export type DataCollection = 'notes' | 'todos' | 'reminders' | 'timers'
export interface DataItems {
  notes: NoteItem[]
  todos: TodoItem[]
  reminders: ReminderItem[]
  timers: TimerView[]
}
export interface DataOps {
  notes: NoteOp
  todos: TodoOp
  reminders: ReminderOp
  timers: TimerOp
}
export type DataResult = { ok: boolean; id?: string }

export type UiIntent = { kind: 'vault-generate'; id: string }

export const PREVIEWS = ['alert', 'happy', 'think', 'sleep', 'greet'] as const
export type MascotPreview = (typeof PREVIEWS)[number]

export type SetSettingsResult = { ok: true } | { ok: false; error: 'invalid' | 'shortcutTaken' }

/** API esposta al renderer dal preload (window.pix). */
export interface PixApi {
  getState(): Promise<UiState>
  onState(cb: (state: UiState) => void): () => void
  setInteractive(interactive: boolean): void
  openPanel(tab?: TabId): void
  closePanel(): void
  setSettings(patch: SettingsPatch): Promise<SetSettingsResult>
  openDataDir(): void
  bubbleOutcome(bubbleId: string, outcome: BubbleOutcome): void
  previewMascot(preview: MascotPreview): void
  clearIntent(): void
  shift: {
    state(): Promise<ShiftState>
    onChange(cb: (state: ShiftState) => void): () => void
    apply(op: ShiftOp): Promise<boolean>
  }
  maintenance: {
    state(): Promise<MaintenanceState>
    onChange(cb: (state: MaintenanceState) => void): () => void
    apply(op: MaintenanceOp): Promise<MaintenanceResult>
  }
  clipboard: {
    state(): Promise<ClipState>
    onChange(cb: (state: ClipState) => void): () => void
    apply(op: ClipOp): Promise<boolean>
  }
  links: {
    list(): Promise<LinkView[]>
    onChange(cb: (items: LinkView[]) => void): () => void
    apply(op: LinkOp): Promise<{ ok: boolean; value?: string }>
  }
  weather(force?: boolean): Promise<WeatherState>
  data: {
    list<C extends DataCollection>(collection: C): Promise<DataItems[C]>
    onChange<C extends DataCollection>(collection: C, cb: (items: DataItems[C]) => void): () => void
    apply<C extends DataCollection>(collection: C, op: DataOps[C]): Promise<DataResult>
  }
  chat: {
    list(): Promise<ConversationItem[]>
    onChange(cb: (items: ConversationItem[]) => void): () => void
    state(): Promise<ChatState>
    onState(cb: (state: ChatState) => void): () => void
    onStream(cb: (ev: ChatStreamEvent) => void): () => void
    apply(op: ChatOp): Promise<ChatOpResult>
  }
  vault: {
    list(): Promise<VaultData>
    onChange(cb: (data: VaultData) => void): () => void
    apply(op: VaultOp): Promise<VaultOpResult>
  }
  deadlines: {
    list(): Promise<DeadlineItem[]>
    onChange(cb: (items: DeadlineItem[]) => void): () => void
    apply(op: DeadlineOp): Promise<boolean>
  }
}

export const IPC = {
  getState: 'ui:get-state',
  state: 'ui:state',
  setInteractive: 'ui:set-interactive',
  openPanel: 'ui:open-panel',
  closePanel: 'ui:close-panel',
  setSettings: 'settings:set',
  openDataDir: 'app:open-data-dir',
  bubbleOutcome: 'mascot:bubble-outcome',
  previewMascot: 'mascot:preview',
  deadlinesList: 'deadlines:list',
  deadlinesChanged: 'deadlines:changed',
  deadlinesApply: 'deadlines:apply',
  clearIntent: 'ui:clear-intent',
  vaultList: 'vault:list',
  vaultChanged: 'vault:changed',
  vaultApply: 'vault:apply',
  chatList: 'chat:list',
  chatChanged: 'chat:changed',
  chatState: 'chat:state',
  chatStateChanged: 'chat:state-changed',
  chatStream: 'chat:stream',
  chatApply: 'chat:apply',
  dataList: 'data:list',
  dataChanged: 'data:changed',
  dataApply: 'data:apply',
  clipState: 'clip:state',
  clipChanged: 'clip:changed',
  clipApply: 'clip:apply',
  linksList: 'links:list',
  linksChanged: 'links:changed',
  linksApply: 'links:apply',
  weather: 'weather:get',
  maintState: 'maint:state',
  maintChanged: 'maint:changed',
  maintApply: 'maint:apply',
  shiftState: 'shift:state',
  shiftChanged: 'shift:changed',
  shiftApply: 'shift:apply'
} as const
