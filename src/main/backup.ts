import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic, isTempName } from './storage/atomic'
import { keyFileSchema, openKeys, readKeyFile, writeKeyFile, type KeyFile, type Keys } from './crypto/keyring'
import { encryptedCodec } from './crypto/codec'
import { BACKUP_RE, backupName, backupsToDelete } from '@shared/maintenance'
import { toISODate } from '@shared/dates'

/**
 * Backup: un unico file con i file delle collezioni così come sono su
 * OneDrive (già cifrati) più il file delle chiavi, che si apre solo con la
 * chiave di recupero. Quindi il backup è leggibile solo con quella chiave.
 */

export const BACKUP_COLLECTIONS = ['settings', 'deadlines', 'vault-meta', 'vault-groups', 'vault', 'chats', 'notes', 'todos', 'reminders', 'links'] as const
/** Collezioni non cifrate (nessun dato sensibile). */
const PLAIN = new Set(['settings'])
const KEEP_DAILY = 7

const backupSchema = z.object({
  format: z.literal('dock-backup'),
  version: z.literal(1),
  createdAt: z.number(),
  deviceName: z.string(),
  keys: keyFileSchema,
  files: z.array(z.object({ collection: z.string(), name: z.string(), content: z.string() }))
})
type BackupFile = z.infer<typeof backupSchema>

export class BackupError extends Error {}

export async function createBackup(dataDir: string, deviceName: string): Promise<string> {
  const keys = await readKeyFile(join(dataDir, 'keys.json'))
  if (!keys) throw new BackupError('not-configured')
  const files: BackupFile['files'] = []
  for (const collection of BACKUP_COLLECTIONS) {
    let names: string[] = []
    try {
      names = await readdir(join(dataDir, collection))
    } catch {
      continue
    }
    for (const name of names) {
      if (isTempName(name) || !name.toLowerCase().endsWith('.json')) continue
      files.push({ collection, name, content: await readFile(join(dataDir, collection, name), 'utf8') })
    }
  }
  const backup: BackupFile = { format: 'dock-backup', version: 1, createdAt: Date.now(), deviceName, keys, files }
  return JSON.stringify(backup)
}

/** Backup giornaliero automatico in locale, con rotazione degli ultimi 7. */
export async function dailyBackup(dataDir: string, backupsDir: string, deviceName: string, now = new Date()): Promise<string | null> {
  await mkdir(backupsDir, { recursive: true })
  const name = backupName(toISODate(now))
  const existing = await readdir(backupsDir)
  if (existing.includes(name)) return null
  await writeFileAtomic(join(backupsDir, name), await createBackup(dataDir, deviceName))
  for (const old of backupsToDelete([...existing, name], KEEP_DAILY)) await rm(join(backupsDir, old), { force: true })
  return name
}

export async function lastBackupTime(backupsDir: string): Promise<number | null> {
  try {
    let best: number | null = null
    for (const n of await readdir(backupsDir)) {
      const m = BACKUP_RE.exec(n)
      if (!m) continue
      const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
      if (best === null || t > best) best = t
    }
    return best
  } catch {
    return null
  }
}

export interface ImportTarget {
  dataDir: string
  deviceId: string
  /** Chiavi attuali di questo PC (null = cassaforte non configurata). */
  currentKeys: () => { syncKey: Buffer | null; dataKey: Buffer | null; configured: boolean }
  /** Adotta le chiavi del backup (PC nuovo / non configurato). */
  adoptKeys: (file: KeyFile, keys: Keys) => Promise<void>
}

/**
 * Importa un backup UNENDO i dati (non sovrascrive): i file vengono aggiunti
 * come se arrivassero da un altro PC e l'unione per voce fa il resto.
 * Se le chiavi del backup sono diverse da quelle attuali, i dati vengono
 * decifrati con le chiavi del backup e ricifrati con quelle attuali.
 */
export async function importBackup(raw: string, recoveryKey: string, target: ImportTarget): Promise<number> {
  let backup: BackupFile
  try {
    backup = backupSchema.parse(JSON.parse(raw))
  } catch {
    throw new BackupError('invalid-backup')
  }
  const backupKeys = await openKeys(backup.keys, recoveryKey)

  let current = target.currentKeys()
  if (!current.configured) {
    await writeKeyFile(join(target.dataDir, 'keys.json'), backup.keys)
    await target.adoptKeys(backup.keys, backupKeys)
    current = target.currentKeys()
  }
  const sameKeys = Boolean(current.syncKey && current.syncKey.equals(backupKeys.syncKey))
  if (!sameKeys && !current.dataKey && backup.files.some((f) => f.collection === 'vault')) throw new BackupError('unlock-first')

  const stamp = Date.now()
  let count = 0
  for (const f of backup.files) {
    let content = f.content
    if (!sameKeys && !PLAIN.has(f.collection)) {
      const from = encryptedCodec({
        key: () => (f.collection === 'vault' ? backupKeys.dataKey : backupKeys.syncKey),
        aad: `dock:${f.collection}`,
        allowPlainRead: true,
        plainWriteWhenNoKey: () => false
      })
      const to = encryptedCodec({
        key: () => (f.collection === 'vault' ? current.dataKey : current.syncKey),
        aad: `dock:${f.collection}`,
        allowPlainRead: false,
        plainWriteWhenNoKey: () => false
      })
      content = await to.encode(await from.decode(content))
    }
    // Nome con il prefisso di questo PC: dopo l'unione verrà archiviato come una copia di conflitto.
    const name = `${target.deviceId}-import-${stamp}-${f.name}`
    await writeFileAtomic(join(target.dataDir, f.collection, name), content)
    count++
  }
  return count
}
