import type { Settings, SettingsPatch } from './settings'
import type { Lang } from './i18n'

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
}

export type SetSettingsResult = { ok: true } | { ok: false; error: 'invalid' | 'shortcutTaken' }

/** API esposta al renderer dal preload (window.dock). */
export interface DockApi {
  getState(): Promise<UiState>
  onState(cb: (state: UiState) => void): () => void
  setInteractive(interactive: boolean): void
  openPanel(tab?: TabId): void
  closePanel(): void
  setSettings(patch: SettingsPatch): Promise<SetSettingsResult>
  openDataDir(): void
}

export const IPC = {
  getState: 'ui:get-state',
  state: 'ui:state',
  setInteractive: 'ui:set-interactive',
  openPanel: 'ui:open-panel',
  closePanel: 'ui:close-panel',
  setSettings: 'settings:set',
  openDataDir: 'app:open-data-dir'
} as const
