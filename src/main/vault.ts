import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import { shell } from 'electron'
import { CollectionStore, type DeviceInfo } from './storage/collection'
import { encryptedCodec } from './crypto/codec'
import type { KeyService } from './keys'
import type { SecureClipboard } from './secureClipboard'
import { toISODate, type ISODate } from '@shared/dates'
import {
  canMoveGroup,
  effectiveGroup,
  effectiveParents,
  generatePassword,
  vaultGroupSchema,
  vaultMetaSchema,
  vaultSecretSchema,
  withNewPassword,
  type GeneratorOptions,
  type VaultEntryInput,
  type VaultData,
  type VaultEntryView,
  type VaultGroup,
  type VaultGroupView,
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
  /** Raccolte (progetti): cifrate con la sync key come i metadati. */
  readonly groups: CollectionStore<VaultGroup>
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
    this.groups = new CollectionStore<VaultGroup>({
      dir: join(dataDir, 'vault-groups'),
      name: 'vault-groups',
      device,
      schema: vaultGroupSchema,
      codec: encryptedCodec({
        key: () => keys.getSyncKey(),
        aad: 'dock:vault-groups',
        allowPlainRead: false,
        plainWriteWhenNoKey: () => false
      }),
      onError
    })
    this.groups.onChange(() => this.emit())
  }

  async load(): Promise<void> {
    if (!this.keys.getSyncKey()) return
    await this.meta.load()
    await this.groups.load()
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
    await this.groups.load()
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

  groupList(): VaultGroupView[] {
    return this.groups.list().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  }

  data(): VaultData {
    return { entries: this.list(), groups: this.groupList() }
  }

  list(): VaultEntryView[] {
    const groups = this.groups.list()
    return this.meta
      .list()
      .map((m) => {
        const s = this.secrets?.get(m.id)
        const view: VaultEntryView = {
          id: m.id,
          name: m.name,
          groupId: effectiveGroup(m.groupId, groups),
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
      snoozedUntil: prevMeta?.snoozedUntil ?? null,
      groupId: input.groupId
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

  /** Sposta una voce in una raccolta (null = senza raccolta). */
  move(id: string, groupId: string | null): boolean {
    if (groupId && !this.groups.get(groupId)) return false
    return this.updateMeta(id, (m) => ({ ...m, groupId }))
  }

  /** Crea una cartella (dentro `parentId`) o ne cambia nome e colore. */
  saveGroup(id: string | undefined, name: string, color: string, parentId?: string | null): string {
    const prev = id ? this.groups.get(id) : undefined
    const order = prev?.order ?? Math.max(0, ...this.groups.list().map((g) => g.order)) + 1
    const parent = prev ? (prev.parentId ?? null) : parentId && this.groups.get(parentId) ? parentId : null
    return this.groups.put({ name, color, order, parentId: parent, id }).id
  }

  /** Sposta una cartella dentro un'altra (null = primo livello), evitando i cicli. */
  moveGroup(id: string, parentId: string | null): boolean {
    const g = this.groups.get(id)
    if (!g || (parentId && !this.groups.get(parentId))) return false
    if (!canMoveGroup(id, parentId, this.groups.list())) return false
    this.groups.put({ name: g.name, color: g.color, order: g.order, parentId, id })
    return true
  }

  /** Elimina una cartella: sottocartelle e password salgono di un livello, niente si perde. */
  removeGroup(id: string): boolean {
    if (!this.groups.get(id)) return false
    const up = effectiveParents(this.groups.list()).get(id) ?? null
    for (const child of this.groups.list()) {
      if (child.parentId === id) this.groups.put({ name: child.name, color: child.color, order: child.order, parentId: up, id: child.id })
    }
    for (const m of this.meta.list()) if (m.groupId === id) this.updateMeta(m.id, (x) => ({ ...x, groupId: up }))
    return this.groups.remove(id)
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
    await Promise.all([this.meta.flush(), this.groups.flush(), this.secrets?.flush()])
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
  return {
    name: m.name,
    intervalDays: m.intervalDays,
    lastChanged: m.lastChanged,
    snoozedUntil: m.snoozedUntil,
    groupId: m.groupId ?? null
  }
}

function stripSecret(s: VaultSecret): VaultSecret {
  return { username: s.username, password: s.password, url: s.url, notes: s.notes, history: s.history }
}
