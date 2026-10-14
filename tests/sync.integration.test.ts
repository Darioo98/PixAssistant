import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KeyService } from '../src/main/keys'
import { DeadlineService } from '../src/main/deadlines'
import { SyncManager } from '../src/main/sync'
import { syncCodec } from '../src/main/crypto/codec'
import { createBackup, importBackup } from '../src/main/backup'
import type { LocalProtector } from '../src/main/crypto/keyring'
import type { PixNative } from '../src/main/native/pixNative'
import { backupsToDelete } from '@shared/maintenance'
import type { DeadlineInput } from '@shared/deadlines'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dock-sync-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const protector: LocalProtector = { protect: (d) => Buffer.from(d).reverse(), unprotect: (d) => Buffer.from(d).reverse() }
const noNative = { available: false, call: async () => false } as unknown as PixNative
const input = (title: string, date = '2027-03-01'): DeadlineInput => ({
  title,
  date,
  recurrence: { unit: 'none', every: 1 },
  leadDays: null,
  category: '',
  notes: ''
})

async function pc(name: string, dataDir = join(root, 'onedrive')) {
  const localDir = join(root, `local-${name}`)
  const device = { id: `${name}-0000-0000`, name }
  const keys = new KeyService({ dataDir, localDir, protector, native: noNative, sessionHours: () => 8, onChange: () => undefined, beforeLock: async () => undefined })
  await keys.init()
  const deadlines = new DeadlineService(dataDir, device, () => undefined, () => undefined, syncCodec(keys, 'deadlines'))
  const notices: number[] = []
  const sync = new SyncManager({ dataDir, localDir, protector, onNewConflicts: (l) => notices.push(l.length) })
  sync.register({ name: 'deadlines', store: () => deadlines.store as never, title: (i) => String(i.title) })
  return { keys, deadlines, sync, notices, dataDir, device }
}

describe('sincronizzazione tra due PC', () => {
  it('modifiche concorrenti: vince la più recente, l’altra è recuperabile', async () => {
    const a = await pc('pc1')
    await a.keys.create()
    const item = a.deadlines.save(input('Bollo auto'))
    await a.deadlines.flush()

    const b = await pc('pc2')
    const recovery = await (async () => {
      // pc2 si collega con la chiave di recupero creata da pc1
      const kf = JSON.parse(await readFile(join(a.dataDir, 'keys.json'), 'utf8'))
      return kf
    })()
    expect(recovery.format).toBe('dock-keys')
    // per il test usiamo direttamente le chiavi di pc1
    ;(b.keys as unknown as { syncKey: Buffer; file: unknown }).syncKey = a.keys.getSyncKey()!
    ;(b.keys as unknown as { file: unknown }).file = recovery
    await b.sync.init()
    await b.sync.reload()
    expect(b.deadlines.list().map((d) => d.title)).toEqual(['Bollo auto'])

    // Entrambi modificano la stessa voce senza vedere la modifica dell'altro.
    a.deadlines.save({ ...input('Bollo auto (pc1)'), id: item.id })
    await new Promise((r) => setTimeout(r, 5))
    b.deadlines.save({ ...input('Bollo auto (pc2)'), id: item.id })
    await Promise.all([a.deadlines.flush(), b.deadlines.flush()])

    await a.sync.init()
    await a.sync.reload()
    expect(a.deadlines.list()[0]!.title).toBe('Bollo auto (pc2)')
    const conflicts = a.sync.list()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ collection: 'deadlines', title: 'Bollo auto (pc1)' })
    expect(a.notices).toEqual([1])

    // Ripristino della versione scartata: diventa la più recente e si propaga.
    expect(await a.sync.resolve(conflicts[0]!.id, 'restore')).toBe(true)
    expect(a.deadlines.list()[0]!.title).toBe('Bollo auto (pc1)')
    await a.deadlines.flush()
    await b.sync.reload()
    expect(b.deadlines.list()[0]!.title).toBe('Bollo auto (pc1)')
    expect(a.sync.list()).toHaveLength(0)
  })

  it('unisce e archivia le copie di conflitto create da OneDrive', async () => {
    const a = await pc('pc1')
    await a.keys.create()
    a.deadlines.save(input('Uno'))
    await a.deadlines.flush()
    const dir = join(a.dataDir, 'deadlines')
    // OneDrive ha tenuto una copia del nostro file con il nome del PC, con una voce in più.
    const other = await pc('pcX')
    ;(other.keys as unknown as { syncKey: Buffer }).syncKey = a.keys.getSyncKey()!
    ;(other.keys as unknown as { file: unknown }).file = {}
    other.deadlines.save(input('Due'))
    await other.deadlines.flush()
    await writeFile(join(dir, `${a.device.id}-PORTATILE.json`), await readFile(join(dir, `${other.device.id}.json`)))
    await rm(join(dir, `${other.device.id}.json`))

    await a.sync.init()
    await a.sync.reload()
    expect(a.deadlines.list().map((d) => d.title).sort()).toEqual(['Due', 'Uno'])
    expect(await readdir(dir)).toEqual([`${a.device.id}.json`])
    const archived = await readdir(join(a.dataDir, '.archive', 'deadlines'))
    expect(archived).toHaveLength(1)
  })
})

describe('backup', () => {
  it('si apre solo con la chiave di recupero e si importa su un PC nuovo', async () => {
    const a = await pc('pc1')
    const recovery = await a.keys.create()
    a.deadlines.save(input('Assicurazione'))
    await a.deadlines.flush()
    const backup = await createBackup(a.dataDir, 'pc1')
    expect(backup).not.toContain('Assicurazione')

    const fresh = await pc('nuovo', join(root, 'onedrive-nuovo'))
    const target = {
      dataDir: fresh.dataDir,
      deviceId: fresh.device.id,
      currentKeys: () => ({ syncKey: fresh.keys.getSyncKey(), dataKey: fresh.keys.getDataKey(), configured: fresh.keys.setup !== 'unconfigured' }),
      adoptKeys: (kf: never, keys: never) => fresh.keys.adopt(kf, keys)
    }
    await expect(importBackup(backup, '0000-0000-0000-0000-0000-0000-0000-0000', target as never)).rejects.toThrow()
    await importBackup(backup, recovery, target as never)
    expect(fresh.keys.setup).toBe('ready')
    await fresh.sync.init()
    await fresh.sync.reload()
    expect(fresh.deadlines.list().map((d) => d.title)).toEqual(['Assicurazione'])
    // il file importato è stato unito e poi archiviato
    expect((await readdir(join(fresh.dataDir, 'deadlines'))).every((n) => !n.includes('import'))).toBe(true)
  })

  it('importa in una cassaforte diversa ricifrando i dati, senza sovrascrivere', async () => {
    const a = await pc('pc1')
    const recoveryA = await a.keys.create()
    a.deadlines.save(input('Da A'))
    await a.deadlines.flush()
    const backup = await createBackup(a.dataDir, 'pc1')

    const b = await pc('pc2', join(root, 'onedrive-b'))
    await b.keys.create()
    b.deadlines.save(input('Da B'))
    await b.deadlines.flush()
    await importBackup(backup, recoveryA, {
      dataDir: b.dataDir,
      deviceId: b.device.id,
      currentKeys: () => ({ syncKey: b.keys.getSyncKey(), dataKey: b.keys.getDataKey(), configured: true }),
      adoptKeys: async () => undefined
    })
    await b.sync.init()
    await b.sync.reload()
    expect(b.deadlines.list().map((d) => d.title).sort()).toEqual(['Da A', 'Da B'])
  })

  it('tiene gli ultimi 7 backup giornalieri', () => {
    const names = Array.from({ length: 10 }, (_, i) => `dock-2026-10-${String(i + 1).padStart(2, '0')}.dockbak`)
    expect(backupsToDelete([...names, 'altro.txt'], 7)).toEqual(names.slice(0, 3))
  })
})
