import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import { shell } from 'electron'
import { CollectionStore, type DeviceInfo } from './storage/collection'
import { encryptedCodec } from './crypto/codec'
import type { KeyService } from './keys'
import type { SecureClipboard } from './secureClipboard'
import { toISODate, type ISODate } from '@shared/dates'
import {
  generatePassword,
  vaultMetaSchema,
  vaultSecretSchema,
  withNewPassword,
  type GeneratorOptions,
  type VaultEntryInput,
  type VaultEntryView,
  type VaultMeta,
  type VaultSecret
} from '@shared/vault'

const EMPTY_SECRET: VaultSecret = { username: '', password: '', url: '', notes: '', history: [] }

/**
 * Cassaforte. I metadati (per i promemoria) sono sempre leggibili con la
 * sync key; i segreti si caricano solo a cassaforte aperta e spariscono dalla
 * memoria quando si chiude.
 */
export class VaultService {
  readonly meta: CollectionStore<VaultMeta>
  private secrets: CollectionStore<VaultSecret> | null = null
  private listeners = new Set<() => void>()

  constructor(
    private readonly dataDir: string,
    private readonly device: DeviceInfo,
    private readonly keys: KeyService,
    private readonly clip: SecureClipboard,
    private readonly onError: (err: unknown, file?: string) => void
  ) {
    this.meta = new CollectionStore<VaultMeta>({
      dir: join(dataDir, 'vault-meta'),
      name: 'vault-meta',
      device,
      schema: vaultMetaSchema,
      codec: encryptedCodec({
        key: () => keys.getSyncKey(),
        aad: 'dock:vault-meta',
        allowPlainRead: false,
        plainWriteWhenNoKey: () => false
      }),
      onError
    })
    this.meta.onChange(() => this.emit())
  }

  async load(): Promise<void> {
    if (this.keys.getSyncKey()) await this.meta.load()
  }

  /** Store dei segreti (solo a cassaforte aperta). */
  get secretsStore(): CollectionStore<VaultSecret> | null {
    return this.secrets
  }

  /** Da chiamare quando la cassaforte si apre: carica i segreti. */
  async opened(): Promise<void> {
    if (!this.secrets) {
      this.secrets = new CollectionStore<VaultSecret>({
        dir: join(this.dataDir, 'vault'),
        name: 'vault',
        device: this.device,
        schema: vaultSecretSchema,
        codec: encryptedCodec({
          key: () => this.keys.getDataKey(),
          aad: 'dock:vault',
          allowPlainRead: false,
          plainWriteWhenNoKey: () => false
        }),
        onError: this.onError
      })
      this.secrets.onChange(() => this.emit())
    }
    await this.meta.load()
    await this.secrets.load()
    this.emit()
  }

  /** Salva le modifiche pendenti prima che la data key venga dimenticata. */
  async beforeLock(): Promise<void> {
    await this.secrets?.flush()
  }

  /** Dopo la chiusura: via i segreti dalla memoria. */
  closed(): void {
    this.secrets = null
    this.emit()
  }

  list(): VaultEntryView[] {
    return this.meta
      .list()
      .map((m) => {
        const s = this.secrets?.get(m.id)
        const view: VaultEntryView = {
          id: m.id,
          name: m.name,
          intervalDays: m.intervalDays,
          lastChanged: m.lastChanged,
          snoozedUntil: m.snoozedUntil
        }
        if (this.secrets) {
          view.username = s?.username ?? ''
          view.url = s?.url ?? ''
          view.notes = s?.notes ?? ''
          view.hasPassword = Boolean(s?.password)
          view.historyCount = s?.history.length ?? 0
        }
        return view
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  metaList() {
    return this.meta.list()
  }

  save(input: VaultEntryInput, today = toISODate(new Date())): string {
    const secrets = this.requireOpen()
    const prevMeta = input.id ? this.meta.get(input.id) : undefined
    const prevSecret = (input.id ? secrets.get(input.id) : undefined) ?? EMPTY_SECRET
    let meta: VaultMeta = {
      name: input.name,
      intervalDays: input.intervalDays,
      lastChanged: prevMeta?.lastChanged ?? today,
      snoozedUntil: prevMeta?.snoozedUntil ?? null
    }
    let secret: VaultSecret = {
      ...stripSecret(prevSecret),
      username: input.username,
      url: input.url,
      notes: input.notes
    }
    // Password modificata a mano: storico aggiornato e countdown che riparte da oggi.
    if (input.password !== undefined && input.password !== prevSecret.password) {
      ;({ secret, meta } = withNewPassword(secret, meta, input.password, Date.now(), today))
      if (!prevMeta) meta.lastChanged = today
    }
    const saved = this.meta.put({ ...meta, id: input.id })
    secrets.put({ ...secret, id: saved.id })
    return saved.id
  }

  remove(id: string): boolean {
    const secrets = this.requireOpen()
    secrets.remove(id)
    return this.meta.remove(id)
  }

  resetCountdown(id: string, today = toISODate(new Date())): boolean {
    return this.updateMeta(id, (m) => ({ ...m, lastChanged: today, snoozedUntil: null }))
  }

  setInterval(id: string, intervalDays: number): boolean {
    return this.updateMeta(id, (m) => ({ ...m, intervalDays }))
  }

  snooze(id: string, until: ISODate): boolean {
    return this.updateMeta(id, (m) => ({ ...m, snoozedUntil: until }))
  }

  generate(opts: GeneratorOptions): string {
    return generatePassword(opts, (max) => randomInt(max))
  }

  /** "Nuova password": genera, salva (storico + countdown azzerato) e copia. */
  async newPassword(id: string, opts: GeneratorOptions, today = toISODate(new Date())): Promise<boolean> {
    const secrets = this.requireOpen()
    const meta = this.meta.get(id)
    if (!meta) return false
    const secret = secrets.get(id) ?? { ...EMPTY_SECRET, id }
    const password = this.generate(opts)
    const next = withNewPassword(stripSecret(secret), stripMeta(meta), password, Date.now(), today)
    this.meta.put({ ...next.meta, id })
    secrets.put({ ...next.secret, id })
    await this.clip.copySecret(password)
    return true
  }

  async copy(id: string, field: 'username' | 'password'): Promise<boolean> {
    const s = this.requireOpen().get(id)
    if (!s) return false
    if (field === 'password') await this.clip.copySecret(s.password)
    else this.clip.copyPlain(s.username)
    return true
  }

  reveal(id: string): string | null {
    return this.requireOpen().get(id)?.password ?? null
  }

  async openUrl(id: string): Promise<boolean> {
    const url = this.requireOpen().get(id)?.url.trim()
    if (!url) return false
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
    try {
      const parsed = new URL(full)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
      await shell.openExternal(parsed.toString())
      return true
    } catch {
      return false
    }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async flush(): Promise<void> {
    await Promise.all([this.meta.flush(), this.secrets?.flush()])
  }

  private updateMeta(id: string, fn: (m: VaultMeta) => VaultMeta): boolean {
    const m = this.meta.get(id)
    if (!m) return false
    this.meta.put({ ...fn(stripMeta(m)), id })
    return true
  }

  private requireOpen(): CollectionStore<VaultSecret> {
    if (!this.secrets || !this.keys.unlocked) throw new Error('locked')
    return this.secrets
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}

function stripMeta(m: VaultMeta): VaultMeta {
  return { name: m.name, intervalDays: m.intervalDays, lastChanged: m.lastChanged, snoozedUntil: m.snoozedUntil }
}

function stripSecret(s: VaultSecret): VaultSecret {
  return { username: s.username, password: s.password, url: s.url, notes: s.notes, history: s.history }
}
