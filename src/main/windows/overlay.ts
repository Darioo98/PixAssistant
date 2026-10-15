import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { sameRect, windowBounds } from '@shared/layout'
import { log } from '../log'

/**
 * Finestra unica, trasparente e sempre in primo piano che contiene barra, Pix,
 * fumetti e pannello. Di base ignora il mouse (i clic passano alle finestre
 * sotto) ma riceve comunque i movimenti (`forward`): il renderer fa l'hit-test
 * sulla forma e ci chiede di diventare cliccabile solo sopra le parti visibili.
 */
export class OverlayWindow {
  readonly win: BrowserWindow
  private interactive = false
  private repositionTimer: NodeJS.Timeout | null = null

  constructor(opts: { preload: string; devUrl?: string; rendererFile: string }) {
    const bounds = windowBounds(screen.getPrimaryDisplay().workArea)
    this.win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      thickFrame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Pix',
      webPreferences: {
        preload: opts.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: true,
        devTools: Boolean(opts.devUrl)
      }
    })
    // Livello più alto di "floating": resta sopra anche alla barra delle applicazioni.
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setIgnoreMouseEvents(true, { forward: true })
    this.win.once('ready-to-show', () => this.showInactive())

    this.win.webContents.on('did-fail-load', (_e, code, desc) => log.error(`Renderer non caricato: ${code} ${desc}`))
    this.win.webContents.on('render-process-gone', (_e, d) => log.error(`Renderer terminato: ${d.reason}`))
    if (opts.devUrl) {
      this.win.webContents.on('console-message', (e) => log.info(`[renderer] ${e.message}`))
    }

    if (opts.devUrl) void this.win.loadURL(opts.devUrl)
    else void this.win.loadFile(opts.rendererFile)

    const schedule = () => this.scheduleReposition()
    screen.on('display-metrics-changed', schedule)
    screen.on('display-added', schedule)
    screen.on('display-removed', schedule)
    this.win.on('closed', () => {
      screen.off('display-metrics-changed', schedule)
      screen.off('display-added', schedule)
      screen.off('display-removed', schedule)
    })
  }

  static rendererPaths(mainDir: string) {
    return {
      preload: join(mainDir, '../preload/index.js'),
      rendererFile: join(mainDir, '../renderer/index.html')
    }
  }

  /** Rende cliccabile la finestra solo quando il mouse è su una parte visibile. */
  setInteractive(value: boolean): void {
    if (this.interactive === value || this.win.isDestroyed()) return
    this.interactive = value
    if (value) this.win.setIgnoreMouseEvents(false)
    else this.win.setIgnoreMouseEvents(true, { forward: true })
  }

  /** Mostra senza rubare il focus alla finestra attiva. */
  showInactive(): void {
    if (this.win.isDestroyed()) return
    this.reposition()
    if (!this.win.isVisible()) this.win.showInactive()
    this.win.setAlwaysOnTop(true, 'screen-saver')
  }

  hide(): void {
    if (!this.win.isDestroyed() && this.win.isVisible()) this.win.hide()
  }

  /** Il pannello si apre: ora sì che prendiamo il focus (l'utente ha interagito). */
  focusForPanel(): void {
    if (this.win.isDestroyed()) return
    this.showInactive()
    this.setInteractive(true)
    this.win.moveTop()
    this.win.focus()
  }

  /** Il pannello si chiude: restituisce il focus a chi lo aveva. */
  releaseFocus(): void {
    if (this.win.isDestroyed()) return
    if (this.win.isFocused()) this.win.blur()
  }

  private scheduleReposition(): void {
    // La barra delle applicazioni e i cambi di risoluzione mandano raffiche di eventi.
    if (this.repositionTimer) clearTimeout(this.repositionTimer)
    this.repositionTimer = setTimeout(() => this.reposition(), 150)
  }

  reposition(): void {
    if (this.win.isDestroyed()) return
    const target = windowBounds(screen.getPrimaryDisplay().workArea)
    if (!sameRect(target, this.win.getBounds())) {
      this.win.setBounds(target)
      log.info(`Riposiziono la finestra: ${JSON.stringify(target)} -> ${JSON.stringify(this.win.getBounds())}`)
    }
  }
}
