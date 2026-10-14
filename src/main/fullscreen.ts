import type { PixNative } from './native/pixNative'

const BUSY_STATES = new Set(['busy', 'd3dFullScreen', 'presentation'])
const POLL_MS = 3000

/**
 * Rileva giochi, presentazioni e app a schermo intero tramite lo stato
 * notifiche di Windows. Windows non offre un evento, quindi interroghiamo
 * ogni 3 s (una chiamata leggerissima) solo se l'opzione è attiva.
 */
export class FullscreenWatcher {
  private timer: NodeJS.Timeout | null = null
  private busy = false

  constructor(
    private readonly native: PixNative,
    private readonly onChange: (busy: boolean) => void
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled && !this.timer && this.native.available) {
      this.timer = setInterval(() => void this.poll(), POLL_MS)
      void this.poll()
    } else if (!enabled && this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.set(false)
    }
  }

  private async poll(): Promise<void> {
    try {
      const state = await this.native.call<string>('notificationState')
      this.set(BUSY_STATES.has(state))
    } catch {
      this.set(false)
    }
  }

  private set(busy: boolean): void {
    if (busy === this.busy) return
    this.busy = busy
    this.onChange(busy)
  }

  dispose(): void {
    this.setEnabled(false)
  }
}
