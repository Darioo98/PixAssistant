import { app, globalShortcut } from 'electron'
import { log } from './log'

/** Avvio automatico al login. In sviluppo non viene registrato (l'eseguibile sarebbe electron.exe). */
export function applyAutostart(enabled: boolean): void {
  // DOCK_NO_AUTOSTART=1: per provare la build senza registrare l'avvio automatico.
  if (!app.isPackaged || process.env.DOCK_NO_AUTOSTART === '1') return
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--autostart'] })
}

/** Scorciatoia globale; restituisce false se la combinazione è già occupata. */
export class GlobalShortcut {
  private current: string | null = null

  constructor(private readonly onPress: () => void) {}

  apply(accelerator: string): boolean {
    if (accelerator === this.current) return true
    const prev = this.current
    if (prev) globalShortcut.unregister(prev)
    let ok = false
    try {
      ok = globalShortcut.register(accelerator, this.onPress)
    } catch (err) {
      log.warn(`Scorciatoia non valida: ${accelerator}`, err)
    }
    if (ok) {
      this.current = accelerator
      return true
    }
    // Ripristina la precedente, così non si resta senza scorciatoia.
    if (prev && globalShortcut.register(prev, this.onPress)) this.current = prev
    else this.current = null
    return false
  }

  dispose(): void {
    globalShortcut.unregisterAll()
  }
}
