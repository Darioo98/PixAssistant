import { app, ipcMain, nativeTheme, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import i18next from 'i18next'
import { initLog, log } from './log'
import { OverlayWindow } from './windows/overlay'
import { DockTray } from './tray'
import { GlobalShortcut, applyAutostart } from './system'
import { FullscreenWatcher } from './fullscreen'
import { PixNative } from './native/pixNative'
import { SettingsService } from './settings'
import { loadDevice } from './storage/device'
import { resolveDataDir } from './storage/paths'
import { IPC, TABS, type DataDirInfo, type SetSettingsResult, type TabId, type UiState } from '@shared/ipc'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { resolveLang, resources, type Lang } from '@shared/i18n'

// Dati locali (mai su OneDrive) in %LOCALAPPDATA%\Dock, non nel profilo roaming.
const localDir = join(process.env.LOCALAPPDATA ?? app.getPath('appData'), 'Dock')
app.setPath('userData', localDir)
app.setAppUserModelId('com.dariocavallo.dock')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void main()
}

async function main(): Promise<void> {
  initLog(localDir)
  hardenSecurity()
  await app.whenReady()
  log.info(`Avvio Dock ${app.getVersion()} (packaged=${app.isPackaged})`)

  const resourcesDir = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const native = new PixNative(join(resourcesDir, 'native', 'PixNative.exe'))

  const settings = new SettingsService(localDir)
  await settings.loadLocal()
  const device = await loadDevice(localDir)
  const dataDir = await prepareDataDir(settings.get().dataDir)
  await settings.attachSynced(dataDir.path, device, (err, file) => log.warn(`Lettura dati non riuscita: ${file}`, err))

  let lang: Lang = resolveLang(settings.get().language, app.getPreferredSystemLanguages())
  await i18next.init({ resources, lng: lang, fallbackLng: 'it', interpolation: { escapeValue: false } })

  // ---- Stato dell'interfaccia ----
  let panelOpen = false
  let tab: TabId = 'home'
  let fullscreenBusy = false

  const overlay = new OverlayWindow({
    ...OverlayWindow.rendererPaths(__dirname),
    devUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  })

  const uiState = (): UiState => ({
    panelOpen,
    tab,
    lang,
    settings: settings.get(),
    dataDir,
    autostartAvailable: app.isPackaged
  })
  const pushState = () => {
    if (!overlay.win.isDestroyed()) overlay.win.webContents.send(IPC.state, uiState())
  }

  const updateVisibility = () => {
    const s = settings.get()
    const visible = panelOpen || (!s.mascotHidden && !fullscreenBusy)
    if (visible) overlay.showInactive()
    else overlay.hide()
  }

  const openPanel = (next?: TabId) => {
    if (next) tab = next
    log.info(`Apro il pannello (${tab})`)
    panelOpen = true
    overlay.focusForPanel()
    pushState()
  }
  const closePanel = () => {
    if (!panelOpen) return
    log.info('Chiudo il pannello')
    panelOpen = false
    overlay.releaseFocus()
    pushState()
    updateVisibility()
  }
  const togglePanel = () => (panelOpen ? closePanel() : openPanel())

  overlay.win.on('blur', () => {
    log.info('Finestra senza focus')
    if (panelOpen && settings.get().closeOnBlur) closePanel()
  })

  // ---- Servizi di sistema ----
  const shortcut = new GlobalShortcut(togglePanel)
  if (!shortcut.apply(settings.get().shortcut)) {
    log.warn(`Scorciatoia ${settings.get().shortcut} occupata, uso quella predefinita`)
    shortcut.apply(DEFAULT_SETTINGS.shortcut)
  }

  const fullscreen = new FullscreenWatcher(native, (busy) => {
    fullscreenBusy = busy
    updateVisibility()
  })

  const tray = new DockTray(join(resourcesDir, 'icons', 'tray.ico'), {
    open: () => openPanel(),
    openSettings: () => openPanel('settings'),
    toggleMascot: () => void settings.set({ mascotHidden: !settings.get().mascotHidden }),
    togglePauseNotifications: () => void settings.set({ notificationsPaused: !settings.get().notificationsPaused }),
    quit: () => app.quit()
  })

  const applySettings = (s: Settings, prev?: Settings) => {
    nativeTheme.themeSource = s.theme
    lang = resolveLang(s.language, app.getPreferredSystemLanguages())
    if (i18next.language !== lang) void i18next.changeLanguage(lang)
    if (!prev || prev.autostart !== s.autostart) applyAutostart(s.autostart)
    fullscreen.setEnabled(s.hideInFullscreen)
    tray.update(i18next.t, s)
    updateVisibility()
    pushState()
  }
  applySettings(settings.get())
  settings.onChange((next, prev) => applySettings(next, prev))

  // ---- IPC (validato: solo dalla nostra finestra, con argomenti controllati) ----
  const fromOverlay = (e: IpcMainEvent | IpcMainInvokeEvent) => e.sender === overlay.win.webContents

  ipcMain.handle(IPC.getState, (e) => (fromOverlay(e) ? uiState() : null))
  ipcMain.on(IPC.setInteractive, (e, value: unknown) => {
    if (fromOverlay(e) && typeof value === 'boolean') overlay.setInteractive(value || panelOpen)
  })
  ipcMain.on(IPC.openPanel, (e, next: unknown) => {
    if (!fromOverlay(e)) return
    openPanel(typeof next === 'string' && (TABS as readonly string[]).includes(next) ? (next as TabId) : undefined)
  })
  ipcMain.on(IPC.closePanel, (e) => {
    if (fromOverlay(e)) closePanel()
  })
  ipcMain.handle(IPC.setSettings, async (e, patch: unknown): Promise<SetSettingsResult> => {
    if (!fromOverlay(e) || typeof patch !== 'object' || patch === null) return { ok: false, error: 'invalid' }
    const p = patch as Record<string, unknown>
    if (typeof p.shortcut === 'string' && !shortcut.apply(p.shortcut)) return { ok: false, error: 'shortcutTaken' }
    return (await settings.set(p)) ? { ok: true } : { ok: false, error: 'invalid' }
  })
  ipcMain.on(IPC.openDataDir, (e) => {
    if (fromOverlay(e)) void shell.openPath(dataDir.path)
  })

  app.on('second-instance', () => openPanel())
  app.on('window-all-closed', () => {
    // L'app vive nell'area di notifica: non si chiude con le finestre.
  })
  app.on('before-quit', () => {
    shortcut.dispose()
    fullscreen.dispose()
    native.dispose()
    tray.destroy()
    void settings.flush()
  })
}

/** Prepara la cartella dati; se OneDrive non è scrivibile ripiega su una cartella locale. */
async function prepareDataDir(custom: string): Promise<DataDirInfo> {
  const info = resolveDataDir(custom, process.env, localDir)
  try {
    await mkdir(info.path, { recursive: true })
    if (info.kind === 'personal' || info.kind === 'business') keepOnDevice(info.path)
    log.info(`Cartella dati: ${info.path} (${info.kind})`)
    return info
  } catch (err) {
    log.error(`Cartella dati non utilizzabile: ${info.path}`, err)
    const fallback = resolveDataDir('', {}, localDir)
    await mkdir(fallback.path, { recursive: true })
    return fallback
  }
}

/** OneDrive "File su richiesta": chiede di tenere sempre i file della cartella su questo PC. */
function keepOnDevice(dir: string): void {
  execFile('attrib', ['+P', '-U', dir], { windowsHide: true }, (err) => {
    if (err) log.warn('Impossibile impostare "Mantieni sempre su questo dispositivo"', err)
  })
}

function hardenSecurity(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (e, url) => {
      if (url !== contents.getURL()) e.preventDefault()
    })
    contents.on('will-attach-webview', (e) => e.preventDefault())
  })
  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
  })
}
