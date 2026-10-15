import { Menu, Tray, nativeImage } from 'electron'
import type { TFunction } from 'i18next'
import type { Settings } from '@shared/settings'

export interface TrayActions {
  open(): void
  openSettings(): void
  toggleMascot(): void
  togglePauseNotifications(): void
  toggleClipboardPause(): void
  quit(): void
}

/** Icona nell'area di notifica, vicino all'orologio. */
export class PixTray {
  private tray: Tray

  constructor(
    iconPath: string,
    private readonly actions: TrayActions
  ) {
    this.tray = new Tray(nativeImage.createFromPath(iconPath))
    this.tray.on('click', () => actions.open())
  }

  update(t: TFunction, settings: Settings): void {
    this.tray.setToolTip(t('tray.tooltip'))
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('tray.open'), click: () => this.actions.open() },
        {
          label: settings.mascotHidden ? t('tray.showMascot') : t('tray.hideMascot'),
          click: () => this.actions.toggleMascot()
        },
        {
          label: t('tray.pauseNotifications'),
          type: 'checkbox',
          checked: settings.notificationsPaused,
          click: () => this.actions.togglePauseNotifications()
        },
        {
          label: t('tray.pauseClipboard'),
          type: 'checkbox',
          checked: settings.clipboardPaused,
          click: () => this.actions.toggleClipboardPause()
        },
        { type: 'separator' },
        { label: t('tray.settings'), click: () => this.actions.openSettings() },
        { type: 'separator' },
        { label: t('tray.quit'), click: () => this.actions.quit() }
      ])
    )
  }

  destroy(): void {
    this.tray.destroy()
  }
}
