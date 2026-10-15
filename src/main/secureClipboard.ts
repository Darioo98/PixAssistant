import { clipboard } from 'electron'
import type { PixNative } from './native/pixNative'
import { log } from './log'

const CLEAR_AFTER_MS = 30_000

/**
 * Copia di dati sensibili: tramite l'helper nativo il testo viene marcato
 * come da escludere dalla cronologia appunti (di Windows e di Pix) e dal
 * cloud. Dopo 30 secondi gli appunti si svuotano, ma solo se contengono
 * ancora quello che abbiamo copiato.
 */
export class SecureClipboard {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly native: PixNative) {}

  get protectedCopy(): boolean {
    return this.native.available
  }

  async copySecret(text: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    if (this.native.available) {
      try {
        const seq = await this.native.call<number>('clipboardSetSecret', { text })
        this.timer = setTimeout(() => {
          void this.native.call('clipboardClearIf', { seq }).catch(() => undefined)
        }, CLEAR_AFTER_MS)
        return
      } catch (err) {
        log.warn('Copia protetta non riuscita, uso la copia normale', err)
      }
    }
    clipboard.writeText(text)
    this.timer = setTimeout(async () => {
      if ((await clipboard.readText()) === text) clipboard.clear()
    }, CLEAR_AFTER_MS)
  }

  /** Copia normale (es. nome utente): resta negli appunti. */
  copyPlain(text: string): void {
    clipboard.writeText(text)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
  }
}
