import { Notification, app, clipboard, dialog, ipcMain, nativeTheme, powerMonitor, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import i18next from 'i18next'
import { initLog, log } from './log'
import { OverlayWindow } from './windows/overlay'
import { PixTray } from './tray'
import { GlobalShortcut, applyAutostart } from './system'
import { FullscreenWatcher } from './fullscreen'
import { PixNative } from './native/pixNative'
import { SettingsService } from './settings'
import { MascotService } from './mascot'
import { DeadlineService } from './deadlines'
import { AlertEngine } from './alerts'
import { deadlineAlerts } from './deadlineAlerts'
import { VaultController } from './vaultController'
import { syncCodec } from './crypto/codec'
import { ClaudeSubscriptionProvider } from './ai/claudeSubscription'
import { ChatService } from './ai/chatService'
import { ProductivityController } from './productivityController'
import { ClipboardHistory } from './clipboardHistory'
import { LinksService } from './links'
import { WeatherService } from './weather'
import { safeStorageProtector } from './vaultController'
import { SyncManager } from './sync'
import { MaintenanceController } from './maintenance'
import { ShiftService } from './shift'
import { loadDevice } from './storage/device'
import { migrateLegacyFolder, resolveDataDir } from './storage/paths'
import { IPC, PREVIEWS, TABS, type DataCollection, type DataDirInfo, type MascotPreview, type UiIntent, type SetSettingsResult, type TabId, type UiState } from '@shared/ipc'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { resolveLang, resources, type Lang } from '@shared/i18n'
import { inTimeRange, type BubbleOutcome } from '@shared/mascot'
import { deadlineOpSchema } from '@shared/deadlines'
import { vaultOpSchema } from '@shared/vault'
import { chatOpSchema } from '@shared/chat'
import { clipOpSchema, linkOpSchema } from '@shared/extras'
import { maintenanceOpSchema } from '@shared/maintenance'
import { formatHHMM, shiftOpSchema } from '@shared/shift'
import { noteTitle } from '@shared/productivity'

// Dati locali (mai su OneDrive) in %LOCALAPPDATA%\Pix, non nel profilo roaming.
const localDir = join(process.env.LOCALAPPDATA ?? app.getPath('appData'), 'Pix')
const migratedLocal = migrateLegacyFolder(localDir)
app.setPath('userData', localDir)
app.setAppUserModelId('com.dariocavallo.pix')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  process.on('unhandledRejection', (err) => log.error('Promessa rifiutata non gestita', err))
  main().catch((err) => {
    // Un avvio a metà è peggio di un errore chiaro.
    log.error('Avvio di Pix non riuscito', err)
    dialog.showErrorBox('Pix', `Pix non è riuscito ad avviarsi.\n\n${err instanceof Error ? err.message : String(err)}\n\nDettagli nel log: ${join(localDir, 'logs', 'pix.log')}`)
    app.quit()
  })
}

async function main(): Promise<void> {
  initLog(localDir)
  if (migratedLocal) log.info('Dati locali spostati da Dock a Pix')
  hardenSecurity()
  await app.whenReady()
  log.info(`Avvio Pix ${app.getVersion()} (packaged=${app.isPackaged})`)

  const resourcesDir = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const native = new PixNative(join(resourcesDir, 'native', 'PixNative.exe'))

  const settings = new SettingsService(localDir)
  await settings.loadLocal()
  const device = await loadDevice(localDir)
  const dataDir = await prepareDataDir(settings.get().dataDir)
  const onDataError = (err: unknown, file?: string) => log.warn(`Lettura dati non riuscita: ${file}`, err)
  await settings.attachSynced(dataDir.path, device, onDataError)
  // Chiavi e cassaforte prima degli altri dati: servono a decifrarli.
  // La reazione ai cambi si collega più avanti, quando finestra e avvisi esistono.
  let onVaultChange = () => {}
  const vaultCtl = new VaultController({
    native,
    dataDir: dataDir.path,
    localDir,
    device,
    settings: () => settings.get(),
    onError: onDataError,
    onSyncKeyReady: async () => {
      // Chiavi appena configurate o PC appena collegato: rilegge e riscrive cifrato.
      await deadlines.load()
      await deadlines.flush()
      await chat.load()
      await chat.flush()
      await productivity.load()
      await productivity.flush()
      await links.load()
      await links.store.flush()
      await vaultCtl.vault.load()
    },
    onChange: () => onVaultChange()
  })
  await vaultCtl.init()
  const deadlines = new DeadlineService(dataDir.path, device, onDataError, () => mascot.celebrate(), syncCodec(vaultCtl.keys, 'deadlines'))
  await deadlines.load()

  /**
   * Invia un evento alla finestra. I dati si caricano prima che la finestra
   * esista: fino ad allora gli eventi si ignorano (il renderer chiede lo stato all'avvio).
   */
  let window: OverlayWindow | null = null
  const sendToRenderer = (channel: string, payload: unknown) => {
    if (window && !window.win.isDestroyed()) window.win.webContents.send(channel, payload)
  }

  // ---- Chat AI (abbonamento Claude tramite Claude Code) ----
  const aiProvider = new ClaudeSubscriptionProvider(join(localDir, 'ai-workdir'), !app.isPackaged)
  const chat = new ChatService({
    dataDir: dataDir.path,
    device,
    codec: syncCodec(vaultCtl.keys, 'chats'),
    onError: onDataError,
    provider: aiProvider,
    claudePath: () => aiProvider.claudePath,
    defaultModel: () => settings.get().aiModel,
    systemPrompt: () => i18next.t('ai.systemPrompt'),
    labels: () => ({ user: i18next.t('ai.labels.user'), assistant: i18next.t('ai.labels.assistant'), newChat: i18next.t('ai.newChat') }),
    onThinking: (thinking) => mascot.setThinking(thinking),
    onStream: (ev) => sendToRenderer(IPC.chatStream, ev),
    onState: () => void chat.state().then((s) => sendToRenderer(IPC.chatStateChanged, s)),
    copy: (text) => clipboard.writeText(text)
  })
  await chat.load()
  chat.store.onChange(() => sendToRenderer(IPC.chatChanged, chat.list()))
  let chatChecked = false

  // ---- Note, to-do, promemoria e timer ----
  const isQuiet = () => {
    const s = settings.get()
    return s.notificationsPaused || (s.dndEnabled && inTimeRange(new Date(), s.dndFrom, s.dndTo))
  }
  const productivity = new ProductivityController({
    dataDir: dataDir.path,
    localDir,
    device,
    codec: (name) => syncCodec(vaultCtl.keys, name),
    onError: onDataError,
    settings: () => settings.get(),
    t: () => i18next.t,
    isQuiet,
    toast: (title, body, onClick) => toast(title, body, onClick),
    bubble: (req) => mascot.notify(req),
    celebrate: () => mascot.celebrate(),
    openPanel: (target) => openPanel(target),
    send: (collection, items) => sendToRenderer(IPC.dataChanged, { collection, items })
  })
  await productivity.load()

  let lang: Lang = resolveLang(settings.get().language, app.getPreferredSystemLanguages())
  await i18next.init({ resources, lng: lang, fallbackLng: 'it', interpolation: { escapeValue: false } })

  // ---- Stato dell'interfaccia ----
  let panelOpen = false
  let tab: TabId = 'home'
  let fullscreenBusy = false
  let intent: UiIntent | null = null
  /** true mentre è aperta una finestra di sistema (es. Windows Hello). */
  let holdOpen = false

  const overlay = new OverlayWindow({
    ...OverlayWindow.rendererPaths(__dirname),
    devUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  })
  window = overlay

  const uiState = (): UiState => ({
    panelOpen,
    tab,
    lang,
    settings: settings.get(),
    dataDir,
    autostartAvailable: app.isPackaged,
    mascot: mascot.state(),
    vault: vaultCtl.status(),
    intent
  })
  const pushVault = () => {
    sendToRenderer(IPC.vaultChanged, vaultCtl.vault.data())
  }
  const pushState = () => {
    if (window) sendToRenderer(IPC.state, uiState())
  }

  const mascot = new MascotService({
    settings: () => settings.get(),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    canShowBubbles: () => !settings.get().mascotHidden && !fullscreenBusy,
    onChange: () => pushState()
  })

  const updateVisibility = () => {
    const s = settings.get()
    const visible = panelOpen || (!s.mascotHidden && !fullscreenBusy)
    if (visible) overlay.showInactive()
    else overlay.hide()
  }

  const openPanel = (next?: TabId) => {
    if (next) tab = next
    log.info(`Apro il pannello (${tab})`)
    const wasOpen = panelOpen
    panelOpen = true
    overlay.focusForPanel()
    mascot.wake()
    if (!wasOpen) mascot.flash('greet')
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
    if (panelOpen && settings.get().closeOnBlur && !holdOpen) closePanel()
  })

  // ---- Avvisi: notifiche di Windows + fumetti di Pix ----
  const toasts = new Set<Notification>()
  const toast = (title: string, body: string, onClick: () => void) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, icon: join(resourcesDir, 'icons', 'pix-256.png') })
    toasts.add(n) // riferimento finché la notifica è viva, altrimenti il clic si perde
    n.on('click', onClick)
    n.on('close', () => toasts.delete(n))
    n.show()
  }
  const alerts = new AlertEngine({
    localDir,
    sources: [
      deadlineAlerts({
        deadlines,
        defaultLead: () => settings.get().defaultLeadDays,
        t: () => i18next.t,
        open: () => openPanel('deadlines')
      }),
      productivity.alertSource(),
      vaultCtl.alertSource({
        t: () => i18next.t,
        generate: (id) => {
          intent = { kind: 'vault-generate', id }
          openPanel('vault')
        }
      })
    ],
    isQuiet,
    toast,
    bubble: (c) =>
      mascot.notify({
        category: c.category,
        text: c.text,
        actions: c.actions,
        onOutcome: (o) => o.kind === 'action' && c.onAction(o.actionId)
      }),
    summary: (count) => ({
      category: i18next.t('alerts.summaryCategory'),
      title: i18next.t('app.name'),
      text: i18next.t('alerts.summary', { count }),
      openLabel: i18next.t('alerts.open')
    }),
    openSummary: () => openPanel('home')
  })
  await alerts.init()
  onVaultChange = () => {
    pushVault()
    pushState()
    alerts.schedule()
  }
  const pushDeadlines = () => {
    sendToRenderer(IPC.deadlinesChanged, deadlines.list())
  }
  productivity.todos.store.onChange(() => alerts.schedule())
  deadlines.onChange(() => {
    pushDeadlines()
    alerts.schedule()
  })
  // Controllo all'avvio (recupera gli avvisi persi), ogni 15 minuti e al ritorno dalla sospensione.
  alerts.schedule(5000)
  await productivity.start()
  const alertTimer = setInterval(() => alerts.schedule(0), 15 * 60_000)
  powerMonitor.on('resume', () => alerts.schedule(3000))
  powerMonitor.on('unlock-screen', () => alerts.schedule(3000))
  // La cassaforte si chiude subito se blocchi Windows o il PC va in sospensione.
  powerMonitor.on('lock-screen', () => void vaultCtl.lock('Windows bloccato'))
  powerMonitor.on('suspend', () => void vaultCtl.lock('sospensione'))

  // ---- Cronologia appunti, link e meteo ----
  const clipHistory = new ClipboardHistory({
    localDir,
    native,
    protector: safeStorageProtector(),
    settings: () => {
      const s = settings.get()
      return { max: s.clipboardMax, paused: s.clipboardPaused, excluded: s.clipboardExcluded, images: s.clipboardImages }
    },
    setPaused: (paused) => void settings.set({ clipboardPaused: paused })
  })
  await clipHistory.init()
  clipHistory.onChange(() => sendToRenderer(IPC.clipChanged, clipHistory.state()))

  const links = new LinksService({
    dataDir: dataDir.path,
    localDir,
    device,
    codec: syncCodec(vaultCtl.keys, 'links'),
    onError: onDataError,
    window: () => overlay.win,
    holdOpen: (hold) => {
      holdOpen = hold
      if (!hold) overlay.focusForPanel()
    },
    onIcons: () => sendToRenderer(IPC.linksChanged, links.list())
  })
  await links.load()
  links.store.onChange(() => sendToRenderer(IPC.linksChanged, links.list()))

  const weather = new WeatherService({ city: () => settings.get().weatherCity, lang: () => lang })

  // ---- Sincronizzazione (modifiche da altri PC, conflitti) e backup ----
  const sync = new SyncManager({
    dataDir: dataDir.path,
    localDir,
    protector: safeStorageProtector(),
    onNewConflicts: (list) => {
      const t = i18next.t
      const text = t('sync.conflictNotice', { count: list.length, title: list[0]?.title ?? '' })
      toast(t('sync.category'), text, () => openPanel('settings'))
      mascot.notify({
        category: t('sync.category'),
        text,
        alert: false,
        actions: [{ id: 'open', label: t('alerts.open'), primary: true }],
        onOutcome: (o) => o.kind === 'action' && openPanel('settings')
      })
    }
  })
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  sync.register({ name: 'settings', store: () => settings.syncedStore, title: (i) => str(i.id) })
  sync.register({ name: 'deadlines', store: () => deadlines.store, title: (i) => str(i.title) })
  sync.register({ name: 'vault-meta', store: () => vaultCtl.vault.meta, title: (i) => str(i.name) })
  sync.register({ name: 'vault-groups', store: () => vaultCtl.vault.groups, title: (i) => str(i.name) })
  sync.register({
    name: 'vault',
    store: () => vaultCtl.vault.secretsStore,
    title: (i) => vaultCtl.vault.meta.get(str(i.id))?.name ?? i18next.t('vault.category')
  })
  sync.register({ name: 'chats', store: () => chat.store, title: (i) => str(i.title) })
  sync.register({ name: 'notes', store: () => productivity.notes.store, title: (i) => noteTitle({ title: str(i.title), body: str(i.body) }, '…') })
  sync.register({ name: 'todos', store: () => productivity.todos.store, title: (i) => str(i.text) })
  sync.register({ name: 'reminders', store: () => productivity.reminders.store, title: (i) => str(i.text) })
  sync.register({ name: 'links', store: () => links.store, title: (i) => str(i.title) })

  const maintenance = new MaintenanceController({
    dataDir: dataDir.path,
    localDir,
    deviceId: device.id,
    deviceName: device.name,
    keys: vaultCtl.keys,
    sync,
    window: () => overlay.win,
    holdOpen: (hold) => {
      holdOpen = hold
      if (!hold) overlay.focusForPanel()
    },
    afterImport: async () => {
      if (vaultCtl.keys.unlocked) await vaultCtl.vault.opened()
      await sync.reload()
      pushState()
    },
    setDataDir: async (dir) => void (await settings.set({ dataDir: dir })),
    onChange: () => sendToRenderer(IPC.maintChanged, maintenance.state())
  })
  sync.onChange(() => sendToRenderer(IPC.maintChanged, maintenance.state()))
  await sync.init()
  sync.start()
  await maintenance.init()

  // ---- Turno di lavoro in sede ----
  const hhmmOf = (d: Date) => formatHHMM(d.getHours() * 60 + d.getMinutes())
  const shift = new ShiftService({
    localDir,
    config: () => {
      const s = settings.get()
      return { workMinutes: s.shiftWorkMinutes, breakMinutes: s.shiftBreakMinutes, remindBefore: s.shiftRemindBefore }
    },
    remind: (minutes, end) => {
      const text = i18next.t('shift.remind', { count: minutes, time: hhmmOf(end) })
      toast(i18next.t('shift.category'), text, () => openPanel('home'))
      mascot.notify({ category: i18next.t('shift.category'), text, alert: false, actions: [{ id: 'ok', label: i18next.t('reminders.ok'), primary: true }] })
    },
    ended: (end) => {
      const text = i18next.t('shift.ended', { time: hhmmOf(end) })
      toast(i18next.t('shift.category'), text, () => openPanel('home'))
      mascot.notify({ category: i18next.t('shift.category'), text, alert: false, actions: [{ id: 'ok', label: i18next.t('reminders.ok'), primary: true }] })
      mascot.celebrate()
    }
  })
  await shift.init()
  shift.onChange(() => sendToRenderer(IPC.shiftChanged, shift.state()))
  powerMonitor.on('unlock-screen', () => void shift.markActivity())
  powerMonitor.on('resume', () => void shift.markActivity())
  settings.onChange((next, prev) => {
    if (next.shiftWorkMinutes !== prev.shiftWorkMinutes || next.shiftBreakMinutes !== prev.shiftBreakMinutes || next.shiftRemindBefore !== prev.shiftRemindBefore) {
      shift.reschedule()
    }
  })

  // ---- Servizi di sistema ----
  const shortcut = new GlobalShortcut(togglePanel)
  if (!shortcut.apply(settings.get().shortcut)) {
    log.warn(`Scorciatoia ${settings.get().shortcut} occupata, uso quella predefinita`)
    shortcut.apply(DEFAULT_SETTINGS.shortcut)
  }
  // Ricerca globale: apre il pannello direttamente nella ricerca.
  const searchShortcut = new GlobalShortcut(() => {
    intent = { kind: 'search' }
    openPanel()
  })
  if (!searchShortcut.apply(settings.get().searchShortcut)) log.warn(`Scorciatoia della ricerca ${settings.get().searchShortcut} occupata`)

  const fullscreen = new FullscreenWatcher(native, (busy) => {
    fullscreenBusy = busy
    updateVisibility()
  })

  const tray = new PixTray(join(resourcesDir, 'icons', 'tray.ico'), {
    open: () => openPanel(),
    openSettings: () => openPanel('settings'),
    toggleMascot: () => void settings.set({ mascotHidden: !settings.get().mascotHidden }),
    togglePauseNotifications: () => void settings.set({ notificationsPaused: !settings.get().notificationsPaused }),
    toggleClipboardPause: () => void settings.set({ clipboardPaused: !settings.get().clipboardPaused }),
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
    alerts.schedule()
  }
  applySettings(settings.get())
  settings.onChange((next, prev) => applySettings(next, prev))

  // ---- IPC (validato: solo dalla nostra finestra, con argomenti controllati) ----
  const fromOverlay = (e: IpcMainEvent | IpcMainInvokeEvent) => e.sender === overlay.win.webContents

  let greeted = false
  ipcMain.handle(IPC.getState, (e) => {
    if (!fromOverlay(e)) return null
    // Saluto all'avvio, quando l'interfaccia è pronta a mostrarlo.
    if (!greeted) {
      greeted = true
      setTimeout(() => mascot.flash('greet', 2200), 400)
    }
    return uiState()
  })
  ipcMain.on(IPC.setInteractive, (e, value: unknown) => {
    if (fromOverlay(e) && typeof value === 'boolean') overlay.setInteractive(value)
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
    if (typeof p.searchShortcut === 'string' && (p.searchShortcut === settings.get().shortcut || !searchShortcut.apply(p.searchShortcut))) {
      return { ok: false, error: 'shortcutTaken' }
    }
    return (await settings.set(p)) ? { ok: true } : { ok: false, error: 'invalid' }
  })
  ipcMain.on(IPC.openDataDir, (e) => {
    if (fromOverlay(e)) void shell.openPath(dataDir.path)
  })

  ipcMain.on(IPC.bubbleOutcome, (e, id: unknown, outcome: unknown) => {
    if (fromOverlay(e) && typeof id === 'string' && isOutcome(outcome)) mascot.resolveBubble(id, outcome)
  })
  ipcMain.on(IPC.previewMascot, (e, preview: unknown) => {
    if (!fromOverlay(e) || !(PREVIEWS as readonly string[]).includes(preview as string)) return
    previewMascot(preview as MascotPreview)
  })

  /** Anteprima degli stati di Pix dalle impostazioni. */
  const previewMascot = (preview: MascotPreview) => {
    if (preview !== 'alert') {
      mascot.flash(preview)
      return
    }
    const t = i18next.t
    mascot.notify({
      category: t('mascot.preview.category'),
      text: t('mascot.preview.text'),
      actions: [
        { id: 'generate', label: t('mascot.preview.generate'), primary: true },
        { id: 'later', label: t('mascot.preview.later') }
      ],
      onOutcome: (o) => {
        log.info(`Fumetto di prova chiuso: ${o.kind}`)
        if (o.kind === 'action' && o.actionId === 'generate') mascot.celebrate()
      }
    })
  }

  ipcMain.handle(IPC.deadlinesList, (e) => (fromOverlay(e) ? deadlines.list() : []))
  ipcMain.handle(IPC.deadlinesApply, (e, op: unknown) => {
    if (!fromOverlay(e)) return false
    const parsed = deadlineOpSchema.safeParse(op)
    return parsed.success ? deadlines.apply(parsed.data) : false
  })

  ipcMain.handle(IPC.vaultList, (e) => (fromOverlay(e) ? vaultCtl.vault.data() : { entries: [], groups: [] }))
  ipcMain.handle(IPC.vaultApply, async (e, op: unknown) => {
    if (!fromOverlay(e)) return { ok: false, error: 'forbidden' }
    const parsed = vaultOpSchema.safeParse(op)
    if (!parsed.success) return { ok: false, error: 'invalid' }
    // Windows Hello mostra la sua finestra: il pannello non deve chiudersi per la perdita del focus.
    const needsSystemPrompt = parsed.data.op === 'unlockHello' || parsed.data.op === 'enrollHello'
    if (needsSystemPrompt) holdOpen = true
    try {
      return await vaultCtl.apply(parsed.data)
    } finally {
      if (needsSystemPrompt) {
        holdOpen = false
        overlay.focusForPanel()
      }
    }
  })
  ipcMain.on(IPC.clearIntent, (e) => {
    if (!fromOverlay(e) || !intent) return
    intent = null
    pushState()
  })

  ipcMain.handle(IPC.chatList, (e) => (fromOverlay(e) ? chat.list() : []))
  ipcMain.handle(IPC.chatState, async (e) => {
    if (!fromOverlay(e)) return null
    // Il login si verifica la prima volta che serve, non a ogni avvio.
    if (!chatChecked) {
      chatChecked = true
      void chat.checkStatus()
    }
    return chat.state()
  })
  ipcMain.handle(IPC.chatApply, async (e, op: unknown) => {
    if (!fromOverlay(e)) return { ok: false, error: 'forbidden' }
    const parsed = chatOpSchema.safeParse(op)
    return parsed.success ? chat.apply(parsed.data) : { ok: false, error: 'invalid' }
  })

  const COLLECTIONS: readonly DataCollection[] = ['notes', 'todos', 'reminders', 'timers']
  ipcMain.handle(IPC.dataList, (e, collection: unknown) =>
    fromOverlay(e) && COLLECTIONS.includes(collection as DataCollection) ? productivity.list(collection as DataCollection) : []
  )
  ipcMain.handle(IPC.dataApply, (e, collection: unknown, op: unknown) =>
    fromOverlay(e) && COLLECTIONS.includes(collection as DataCollection)
      ? productivity.apply(collection as DataCollection, op)
      : { ok: false }
  )

  ipcMain.handle(IPC.clipState, (e) => (fromOverlay(e) ? clipHistory.state() : null))
  ipcMain.handle(IPC.clipApply, async (e, op: unknown) => {
    if (!fromOverlay(e)) return false
    const parsed = clipOpSchema.safeParse(op)
    return parsed.success ? clipHistory.apply(parsed.data) : false
  })
  ipcMain.handle(IPC.linksList, (e) => (fromOverlay(e) ? links.list() : []))
  ipcMain.handle(IPC.linksApply, async (e, op: unknown) => {
    if (!fromOverlay(e)) return { ok: false }
    const parsed = linkOpSchema.safeParse(op)
    return parsed.success ? links.apply(parsed.data) : { ok: false }
  })
  ipcMain.handle(IPC.weather, (e, force: unknown) => (fromOverlay(e) ? weather.get(force === true) : { status: 'off' }))

  ipcMain.handle(IPC.maintState, (e) => (fromOverlay(e) ? maintenance.state() : null))
  ipcMain.handle(IPC.maintApply, async (e, op: unknown) => {
    if (!fromOverlay(e)) return { ok: false, error: 'forbidden' }
    const parsed = maintenanceOpSchema.safeParse(op)
    return parsed.success ? maintenance.apply(parsed.data) : { ok: false, error: 'invalid' }
  })

  ipcMain.handle(IPC.shiftState, (e) => (fromOverlay(e) ? shift.state() : null))
  ipcMain.handle(IPC.shiftApply, async (e, op: unknown) => {
    if (!fromOverlay(e)) return false
    const parsed = shiftOpSchema.safeParse(op)
    return parsed.success ? shift.apply(parsed.data) : false
  })

  app.on('second-instance', () => openPanel())
  app.on('window-all-closed', () => {
    // L'app vive nell'area di notifica: non si chiude con le finestre.
  })
  app.on('before-quit', () => {
    shortcut.dispose()
    searchShortcut.dispose()
    mascot.dispose()
    chat.stopAll()
    productivity.dispose()
    sync.dispose()
    shift.dispose()
    maintenance.dispose()
    void clipHistory.flush()
    void links.store.flush()
    void productivity.flush()
    void chat.flush()
    alerts.dispose()
    clearInterval(alertTimer)
    void deadlines.flush()
    void vaultCtl.flush().finally(() => vaultCtl.dispose())
    fullscreen.dispose()
    native.dispose()
    tray.destroy()
    void settings.flush()
  })
}

function isOutcome(v: unknown): v is BubbleOutcome {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.kind === 'dismiss' || o.kind === 'timeout') return true
  return o.kind === 'action' && typeof o.actionId === 'string' && o.actionId.length <= 64
}

/** Prepara la cartella dati; se OneDrive non è scrivibile ripiega su una cartella locale. */
async function prepareDataDir(custom: string): Promise<DataDirInfo> {
  const info = resolveDataDir(custom, process.env, localDir)
  if (info.kind === 'personal' || info.kind === 'business') {
    if (migrateLegacyFolder(info.path)) log.info('Cartella OneDrive Dock rinominata in Pix')
  }
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
