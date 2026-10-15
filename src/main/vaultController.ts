import { safeStorage } from 'electron'
import type { TFunction } from 'i18next'
import { KeyError, KeyService } from './keys'
import { VaultService } from './vault'
import { SecureClipboard } from './secureClipboard'
import { WrongKeyError } from './crypto/crypto'
import type { LocalProtector } from './crypto/keyring'
import type { DeviceInfo } from './storage/collection'
import type { PixNative } from './native/pixNative'
import type { AlertSource } from './alerts'
import { log } from './log'
import { addDays } from '@shared/dates'
import type { Settings } from '@shared/settings'
import { countdown, needsPasswordAlert, type VaultOp, type VaultOpResult, type VaultStatus } from '@shared/vault'

/** DPAPI tramite safeStorage di Electron (legato all'utente Windows di questo PC). */
export function safeStorageProtector(): LocalProtector {
  return {
    protect: (data) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('dpapi-unavailable')
      return safeStorage.encryptString(data.toString('base64'))
    },
    unprotect: (data) => Buffer.from(safeStorage.decryptString(data), 'base64')
  }
}

export interface VaultControllerDeps {
  native: PixNative
  dataDir: string
  localDir: string
  device: DeviceInfo
  settings: () => Settings
  onError: (err: unknown, file?: string) => void
  /** Chiavi appena configurate o collegate: ricarica e cifra gli altri dati. */
  onSyncKeyReady: () => Promise<void>
  onChange: () => void
}

export class VaultController {
  readonly keys: KeyService
  readonly vault: VaultService
  readonly clipboard: SecureClipboard
  /** Chiave di recupero appena creata: resta qui finché l'utente non conferma di averla salvata. */
  private pendingRecovery: string | null = null

  constructor(private readonly deps: VaultControllerDeps) {
    this.clipboard = new SecureClipboard(deps.native)
    this.keys = new KeyService({
      dataDir: deps.dataDir,
      localDir: deps.localDir,
      protector: safeStorageProtector(),
      native: deps.native,
      sessionHours: () => deps.settings().vaultSessionHours,
      beforeLock: () => this.vault.beforeLock(),
      onChange: () => {
        if (!this.keys.unlocked) this.vault.closed()
        deps.onChange()
      }
    })
    this.vault = new VaultService(deps.dataDir, deps.device, this.keys, this.clipboard, deps.onError)
    this.vault.onChange(() => deps.onChange())
  }

  async init(): Promise<void> {
    await this.keys.init()
    await this.vault.load()
  }

  status(): VaultStatus {
    return {
      setup: this.keys.setup,
      unlocked: this.keys.unlocked,
      unlockedUntil: this.keys.unlockedUntil,
      helloAvailable: this.keys.hello.available,
      helloEnrolled: this.keys.hello.enrolled,
      secureClipboard: this.clipboard.protectedCopy,
      recoveryPending: this.pendingRecovery !== null
    }
  }

  lock(reason: string): Promise<void> {
    return this.keys.lock(reason)
  }

  async apply(op: VaultOp): Promise<VaultOpResult> {
    try {
      return await this.run(op)
    } catch (err) {
      const error =
        err instanceof WrongKeyError ? 'wrong-key' : err instanceof KeyError || err instanceof Error ? err.message : 'error'
      if (error !== 'wrong-key' && !error.startsWith('hello-canceled')) log.warn(`Operazione cassaforte "${op.op}" non riuscita`, err)
      return { ok: false, error }
    }
  }

  private async run(op: VaultOp): Promise<VaultOpResult> {
    switch (op.op) {
      case 'setup': {
        this.pendingRecovery = await this.keys.create()
        await this.deps.onSyncKeyReady()
        await this.vault.opened()
        return { ok: true }
      }
      case 'pendingRecovery':
        return this.pendingRecovery ? { ok: true, value: this.pendingRecovery } : { ok: false, error: 'not-found' }
      case 'copyRecovery':
        if (!this.pendingRecovery) return { ok: false, error: 'not-found' }
        await this.clipboard.copySecret(this.pendingRecovery)
        return { ok: true }
      case 'ackRecovery':
        this.pendingRecovery = null
        this.deps.onChange()
        return { ok: true }
      case 'link':
      case 'unlockRecovery': {
        const wasReady = this.keys.setup === 'ready'
        await this.keys.unlockWithRecovery(op.recoveryKey)
        if (!wasReady) await this.deps.onSyncKeyReady()
        await this.vault.opened()
        return { ok: true }
      }
      case 'unlockHello':
        await this.keys.unlockWithHello()
        await this.vault.opened()
        return { ok: true }
      case 'enrollHello':
        await this.keys.enrollHello()
        return { ok: true }
      case 'removeHello':
        await this.keys.removeHello()
        return { ok: true }
      case 'lock':
        await this.keys.lock('manuale')
        return { ok: true }
      case 'save':
        return { ok: true, value: this.vault.save(op.input) }
      case 'remove':
        return ok(this.vault.remove(op.id))
      case 'resetCountdown':
        return ok(this.vault.resetCountdown(op.id))
      case 'setInterval':
        return ok(this.vault.setInterval(op.id, op.intervalDays))
      case 'snooze':
        return ok(this.vault.snooze(op.id, op.until))
      case 'newPassword':
        return ok(await this.vault.newPassword(op.id, op.options))
      case 'generate':
        return { ok: true, value: this.vault.generate(op.options) }
      case 'copy':
        return ok(await this.vault.copy(op.id, op.field))
      case 'copyText':
        await this.clipboard.copySecret(op.text)
        return { ok: true }
      case 'health':
        return { ok: true, health: this.vault.health() }
      case 'reveal': {
        const value = this.vault.reveal(op.id)
        return value === null ? { ok: false, error: 'not-found' } : { ok: true, value }
      }
      case 'openUrl':
        return ok(await this.vault.openUrl(op.id))
      case 'move':
        return ok(this.vault.move(op.id, op.groupId))
      case 'groupSave':
        return { ok: true, value: this.vault.saveGroup(op.id, op.name, op.color, op.parentId) }
      case 'groupMove':
        return this.vault.moveGroup(op.id, op.parentId) ? { ok: true } : { ok: false, error: 'invalid-move' }
      case 'groupRemove':
        return ok(this.vault.removeGroup(op.id))
    }
  }

  /** Avvisi "password da cambiare": funzionano anche a cassaforte chiusa (solo metadati). */
  alertSource(opts: { t: () => TFunction; generate: (id: string) => void }): AlertSource {
    return (today) => {
      const t = opts.t()
      const lead = this.deps.settings().defaultLeadDays
      return this.vault
        .metaList()
        .filter((m) => needsPasswordAlert(m, today, lead))
        .map((m) => {
          const days = countdown(m, today, lead).daysLeft ?? 0
          return {
            key: `password:${m.id}`,
            category: t('vault.category'),
            title: m.name,
            text: days <= 0 ? t('vault.alert.due', { name: m.name }) : t('vault.alert.soon', { name: m.name, count: days }),
            actions: [
              { id: 'later', label: t('vault.alert.later') },
              { id: 'generate', label: t('vault.alert.generate'), primary: true }
            ],
            onOpen: () => opts.generate(m.id),
            onAction: (id) => {
              if (id === 'generate') opts.generate(m.id)
              else this.vault.snooze(m.id, addDays(today, 1))
            }
          }
        })
    }
  }

  async flush(): Promise<void> {
    await this.vault.flush()
  }

  dispose(): void {
    this.keys.dispose()
    this.clipboard.dispose()
  }
}

function ok(value: boolean): VaultOpResult {
  return value ? { ok: true } : { ok: false, error: 'not-found' }
}
