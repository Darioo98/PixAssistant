import { app, dialog, shell, type BrowserWindow } from 'electron'
import { cp, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './storage/atomic'
import { BackupError, createBackup, dailyBackup, importBackup, lastBackupTime } from './backup'
import { WrongKeyError } from './crypto/crypto'
import type { KeyService } from './keys'
import type { SyncManager } from './sync'
import { log } from './log'
import { toISODate } from '@shared/dates'
import type { MaintenanceOp, MaintenanceResult, MaintenanceState } from '@shared/maintenance'

const DAILY_CHECK_MS = 6 * 3_600_000

export class MaintenanceController {
  private timer: NodeJS.Timeout | null = null
  private last: number | null = null

  constructor(
    private readonly opts: {
      dataDir: string
      localDir: string
      deviceId: string
      deviceName: string
      keys: KeyService
      sync: SyncManager
      window: () => BrowserWindow
      holdOpen: (hold: boolean) => void
      /** Dopo un import: ricarica tutto (anche le collezioni non sincronizzate dal watcher). */
      afterImport: () => Promise<void>
      setDataDir: (dir: string) => Promise<void>
      onChange: () => void
    }
  ) {}

  get backupsDir(): string {
    return join(this.opts.localDir, 'backups')
  }

  async init(): Promise<void> {
    this.last = await lastBackupTime(this.backupsDir)
    setTimeout(() => void this.daily(), 20_000)
    this.timer = setInterval(() => void this.daily(), DAILY_CHECK_MS)
  }

  state(): MaintenanceState {
    return {
      conflicts: this.opts.sync.list(),
      lastBackup: this.last,
      backupsDir: this.backupsDir,
      canBackup: this.opts.keys.setup !== 'unconfigured',
      lastSync: this.opts.sync.lastSync
    }
  }

  private async daily(): Promise<void> {
    if (this.opts.keys.setup === 'unconfigured') return
    try {
      const made = await dailyBackup(this.opts.dataDir, this.backupsDir, this.opts.deviceName)
      if (made) {
        this.last = Date.now()
        log.info(`Backup automatico creato: ${made}`)
        this.opts.onChange()
      }
    } catch (err) {
      log.warn('Backup automatico non riuscito', err)
    }
  }

  async apply(op: MaintenanceOp): Promise<MaintenanceResult> {
    try {
      return await this.run(op)
    } catch (err) {
      const error = err instanceof WrongKeyError ? 'wrong-key' : err instanceof BackupError ? err.message : 'generic'
      if (error === 'generic') log.error(`Operazione "${op.op}" non riuscita`, err)
      return { ok: false, error }
    }
  }

  private async withDialog<T>(fn: () => Promise<T>): Promise<T> {
    this.opts.holdOpen(true)
    try {
      return await fn()
    } finally {
      this.opts.holdOpen(false)
    }
  }

  private async run(op: MaintenanceOp): Promise<MaintenanceResult> {
    switch (op.op) {
      case 'export': {
        const res = await this.withDialog(() =>
          dialog.showSaveDialog(this.opts.window(), {
            defaultPath: join(app.getPath('documents'), `Dock-backup-${toISODate(new Date())}.dockbak`),
            filters: [{ name: 'Backup di Dock', extensions: ['dockbak'] }]
          })
        )
        if (res.canceled || !res.filePath) return { ok: false, error: 'canceled' }
        await writeFileAtomic(res.filePath, await createBackup(this.opts.dataDir, this.opts.deviceName))
        log.info('Backup esportato')
        return { ok: true, value: res.filePath }
      }
      case 'import': {
        const res = await this.withDialog(() =>
          dialog.showOpenDialog(this.opts.window(), {
            properties: ['openFile'],
            defaultPath: this.backupsDir,
            filters: [{ name: 'Backup di Dock', extensions: ['dockbak'] }]
          })
        )
        const file = res.filePaths[0]
        if (res.canceled || !file) return { ok: false, error: 'canceled' }
        const count = await importBackup(await readFile(file, 'utf8'), op.recoveryKey, {
          dataDir: this.opts.dataDir,
          deviceId: this.opts.deviceId,
          currentKeys: () => ({
            syncKey: this.opts.keys.getSyncKey(),
            dataKey: this.opts.keys.getDataKey(),
            configured: this.opts.keys.setup !== 'unconfigured'
          }),
          adoptKeys: (kf, keys) => this.opts.keys.adopt(kf, keys)
        })
        await this.opts.afterImport()
        log.info(`Backup importato: ${count} file uniti`)
        return { ok: true, value: String(count) }
      }
      case 'backupNow': {
        if (this.opts.keys.setup === 'unconfigured') return { ok: false, error: 'not-configured' }
        const name = `dock-${toISODate(new Date())}-${Date.now()}.dockbak`
        await writeFileAtomic(join(this.backupsDir, name), await createBackup(this.opts.dataDir, this.opts.deviceName))
        this.last = Date.now()
        this.opts.onChange()
        return { ok: true }
      }
      case 'openBackups':
        await shell.openPath(this.backupsDir)
        return { ok: true }
      case 'resolveConflict':
        return (await this.opts.sync.resolve(op.id, op.action)) ? { ok: true } : { ok: false, error: 'not-found' }
      case 'changeDataDir': {
        const res = await this.withDialog(() => dialog.showOpenDialog(this.opts.window(), { properties: ['openDirectory', 'createDirectory'] }))
        const dir = res.filePaths[0]
        if (res.canceled || !dir) return { ok: false, error: 'canceled' }
        // Se la nuova cartella è vuota ci si copiano i dati attuali; altrimenti si usano i dati che contiene.
        const empty = (await readdir(dir)).length === 0
        if (empty) await cp(this.opts.dataDir, dir, { recursive: true, errorOnExist: false, force: false })
        await this.opts.setDataDir(dir)
        log.info(`Cartella dati cambiata: ${dir} (copiati: ${empty})`)
        app.relaunch()
        app.quit()
        return { ok: true }
      }
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
