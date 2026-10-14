import { join } from 'node:path'
import { z } from 'zod'
import { CollectionStore, type DeviceInfo } from './storage/collection'
import { readJson, writeJson } from './storage/localJson'
import {
  coerceSettings,
  isLocalKey,
  settingsPatchSchema,
  type Settings,
  type SettingsPatch
} from '@shared/settings'

const settingValueSchema = z.object({ value: z.unknown() })
type SettingValue = z.infer<typeof settingValueSchema>

/**
 * Impostazioni divise in due: quelle del PC in un file locale, quelle condivise
 * in una collezione sincronizzata (una voce per chiave, così due PC che cambiano
 * impostazioni diverse non si pestano i piedi).
 */
export class SettingsService {
  private local: Record<string, unknown> = {}
  private synced: CollectionStore<SettingValue> | null = null
  private current: Settings = coerceSettings({})
  private listeners = new Set<(next: Settings, prev: Settings) => void>()

  constructor(private readonly localDir: string) {}

  private get localFile(): string {
    return join(this.localDir, 'settings.json')
  }

  async loadLocal(): Promise<Settings> {
    this.local = await readJson<Record<string, unknown>>(this.localFile, {})
    this.recompute()
    return this.current
  }

  /** Collega le impostazioni condivise alla cartella dati (dopo aver letto quelle locali). */
  async attachSynced(dataDir: string, device: DeviceInfo, onError: (err: unknown, file?: string) => void) {
    this.synced = new CollectionStore<SettingValue>({
      dir: join(dataDir, 'settings'),
      name: 'settings',
      device,
      schema: settingValueSchema,
      onError
    })
    await this.synced.load()
    this.synced.onChange(() => this.recompute())
    this.recompute()
  }

  get(): Settings {
    return this.current
  }

  /** Applica una modifica; restituisce false se i valori non sono validi. */
  async set(patch: SettingsPatch): Promise<boolean> {
    const parsed = settingsPatchSchema.safeParse(patch)
    if (!parsed.success) return false
    let localChanged = false
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue
      if (isLocalKey(key) || !this.synced) {
        this.local[key] = value
        localChanged = true
      } else if (this.synced.get(key)?.value !== value) {
        this.synced.put({ id: key, value })
      }
    }
    if (localChanged) await writeJson(this.localFile, this.local)
    this.recompute()
    return true
  }

  onChange(cb: (next: Settings, prev: Settings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async flush(): Promise<void> {
    await this.synced?.flush()
  }

  private recompute(): void {
    const raw: Record<string, unknown> = {}
    // Valori condivisi; se una chiave condivisa esiste ancora nel file locale
    // (es. prima di collegare OneDrive) vince quella sincronizzata.
    for (const [k, v] of Object.entries(this.local)) raw[k] = v
    for (const item of this.synced?.list() ?? []) {
      if (!isLocalKey(item.id)) raw[item.id] = item.value
    }
    const next = coerceSettings(raw)
    const prev = this.current
    this.current = next
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      for (const cb of this.listeners) cb(next, prev)
    }
  }
}
