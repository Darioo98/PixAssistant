import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './storage/atomic'
import { WrongKeyError } from './crypto/crypto'
import {
  createKeys,
  helloFileSchema,
  newHelloChallenge,
  openKeys,
  openWithHello,
  readKeyFile,
  sealWithHello,
  writeKeyFile,
  type HelloFile,
  type KeyFile,
  type LocalProtector
} from './crypto/keyring'
import type { PixNative } from './native/pixNative'
import { log } from './log'

export type SetupState = 'unconfigured' | 'needsRecovery' | 'ready'

export class KeyError extends Error {}

const HELLO_CREDENTIAL = 'Dock.Vault'
const HELLO_TIMEOUT_MS = 180_000

interface HelloResult {
  status: 'success' | 'canceled' | 'notFound' | 'locked' | 'error'
  signature?: string
}

/**
 * Custode delle chiavi. La sync key resta disponibile finché il PC è
 * collegato; la data key (cassaforte) solo durante la sessione di sblocco,
 * e solo in memoria nel processo main.
 */
export class KeyService {
  private file: KeyFile | null = null
  private syncKey: Buffer | null = null
  private dataKey: Buffer | null = null
  private until: number | null = null
  private timer: NodeJS.Timeout | null = null
  private helloEnrolled = false
  private helloAvailable = false

  constructor(
    private readonly opts: {
      dataDir: string
      localDir: string
      protector: LocalProtector
      native: PixNative
      sessionHours: () => number
      onChange: () => void
      /** Chiamata prima di dimenticare la data key: salva le modifiche pendenti. */
      beforeLock: () => Promise<void>
    }
  ) {}

  private get keyFilePath() {
    return join(this.opts.dataDir, 'keys.json')
  }
  private get syncKeyPath() {
    return join(this.opts.localDir, 'sync-key.bin')
  }
  private get helloPath() {
    return join(this.opts.localDir, 'vault-hello.bin')
  }

  async init(): Promise<void> {
    this.file = await readKeyFile(this.keyFilePath).catch((err) => {
      log.error('keys.json illeggibile', err)
      return null
    })
    try {
      this.syncKey = this.opts.protector.unprotect(await readFile(this.syncKeyPath))
    } catch {
      this.syncKey = null
    }
    this.helloEnrolled = (await this.readHelloFile()) !== null
    this.helloAvailable = this.opts.native.available
      ? await this.opts.native.call<boolean>('helloAvailable').catch(() => false)
      : false
  }

  get setup(): SetupState {
    if (!this.file) return 'unconfigured'
    return this.syncKey ? 'ready' : 'needsRecovery'
  }

  get unlocked(): boolean {
    return this.dataKey !== null
  }

  get unlockedUntil(): number | null {
    return this.until
  }

  get hello() {
    return { available: this.helloAvailable, enrolled: this.helloEnrolled }
  }

  /** Chiave per i dati sincronizzati (scadenze, metadati…). */
  getSyncKey(): Buffer | null {
    return this.syncKey
  }

  /** Chiave della cassaforte, solo a cassaforte aperta. */
  getDataKey(): Buffer | null {
    return this.dataKey
  }

  /** Prima configurazione: crea le chiavi e restituisce la chiave di recupero da mostrare una volta. */
  async create(): Promise<string> {
    if (this.file || (await readKeyFile(this.keyFilePath))) throw new KeyError('already-configured')
    const { file, keys, recoveryKey } = await createKeys()
    await writeKeyFile(this.keyFilePath, file)
    this.file = file
    await this.storeSyncKey(keys.syncKey)
    this.startSession(keys.dataKey)
    return recoveryKey
  }

  /** Collega un PC nuovo (o ripristina) con la chiave di recupero e apre la cassaforte. */
  async unlockWithRecovery(recoveryKey: string): Promise<void> {
    this.file ??= await readKeyFile(this.keyFilePath)
    if (!this.file) throw new KeyError('not-configured')
    const keys = await openKeys(this.file, recoveryKey)
    if (!this.syncKey || !this.syncKey.equals(keys.syncKey)) await this.storeSyncKey(keys.syncKey)
    this.startSession(keys.dataKey)
  }

  /** Adotta le chiavi di un backup su un PC non ancora configurato. */
  async adopt(file: KeyFile, keys: { syncKey: Buffer; dataKey: Buffer }): Promise<void> {
    this.file = file
    await this.storeSyncKey(keys.syncKey)
    this.startSession(keys.dataKey)
  }

  async unlockWithHello(): Promise<void> {
    const hf = await this.readHelloFile()
    if (!hf) throw new KeyError('hello-not-enrolled')
    const res = await this.opts.native.call<HelloResult>(
      'helloSign',
      { name: hf.credential, challenge: hf.challenge },
      HELLO_TIMEOUT_MS
    )
    if (res.status !== 'success' || !res.signature) throw new KeyError(`hello-${res.status}`)
    try {
      this.startSession(openWithHello(hf, res.signature))
    } catch (err) {
      if (err instanceof WrongKeyError) throw new KeyError('hello-mismatch')
      throw err
    }
  }

  /** Registra Windows Hello su questo PC (richiede la cassaforte aperta). */
  async enrollHello(): Promise<void> {
    if (!this.dataKey) throw new KeyError('locked')
    const { challenge, salt } = newHelloChallenge()
    const res = await this.opts.native.call<HelloResult>(
      'helloEnroll',
      { name: HELLO_CREDENTIAL, challenge },
      HELLO_TIMEOUT_MS
    )
    if (res.status !== 'success' || !res.signature) throw new KeyError(`hello-${res.status}`)
    const hf = sealWithHello(this.dataKey, res.signature, { credential: HELLO_CREDENTIAL, challenge, salt })
    await writeFileAtomic(this.helloPath, this.opts.protector.protect(Buffer.from(JSON.stringify(hf))))
    this.helloEnrolled = true
    this.opts.onChange()
  }

  async removeHello(): Promise<void> {
    await this.opts.native.call('helloDelete', { name: HELLO_CREDENTIAL }).catch(() => undefined)
    await rm(this.helloPath, { force: true })
    this.helloEnrolled = false
    this.opts.onChange()
  }

  /** Chiude la cassaforte: salva le modifiche pendenti e dimentica la data key. */
  lock(reason: string): Promise<void> {
    if (!this.dataKey) return Promise.resolve()
    // Blocco di Windows e sospensione possono arrivare insieme: una sola chiusura alla volta.
    this.locking ??= this.doLock(reason).finally(() => (this.locking = null))
    return this.locking
  }

  private locking: Promise<void> | null = null

  private async doLock(reason: string): Promise<void> {
    try {
      await this.opts.beforeLock()
    } catch (err) {
      log.error('Salvataggio prima della chiusura non riuscito', err)
    }
    this.dataKey?.fill(0)
    this.dataKey = null
    this.until = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    log.info(`Cassaforte chiusa (${reason})`)
    this.opts.onChange()
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.dataKey?.fill(0)
  }

  private startSession(dataKey: Buffer): void {
    this.dataKey?.fill(0)
    this.dataKey = dataKey
    const ms = this.opts.sessionHours() * 3_600_000
    this.until = Date.now() + ms
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.lock('fine sessione'), ms)
    log.info('Cassaforte aperta')
    this.opts.onChange()
  }

  private async storeSyncKey(key: Buffer): Promise<void> {
    await writeFileAtomic(this.syncKeyPath, this.opts.protector.protect(key))
    this.syncKey = key
  }

  private async readHelloFile(): Promise<HelloFile | null> {
    try {
      const raw = this.opts.protector.unprotect(await readFile(this.helloPath)).toString('utf8')
      return helloFileSchema.parse(JSON.parse(raw))
    } catch {
      return null
    }
  }
}
