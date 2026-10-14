import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KeyService } from '../src/main/keys'
import { VaultService } from '../src/main/vault'
import { DeadlineService } from '../src/main/deadlines'
import { syncCodec } from '../src/main/crypto/codec'
import type { LocalProtector } from '../src/main/crypto/keyring'
import type { PixNative } from '../src/main/native/pixNative'
import type { SecureClipboard } from '../src/main/secureClipboard'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dock-vault-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Finto DPAPI: inverte i byte (basta a verificare che il file locale non sia in chiaro). */
const protector: LocalProtector = {
  protect: (d) => Buffer.from(d).reverse(),
  unprotect: (d) => Buffer.from(d).reverse()
}
const noNative = { available: false, call: async () => false } as unknown as PixNative
const copied: string[] = []
const clip = { copySecret: async (t: string) => void copied.push(t), copyPlain: () => undefined } as unknown as SecureClipboard

/** Un "PC": cartella locale propria, cartella OneDrive condivisa. */
async function pc(name: string) {
  const localDir = join(root, `local-${name}`)
  const dataDir = join(root, 'onedrive')
  const device = { id: `${name}-0000-0000`, name }
  let vault: VaultService | null = null
  const keys = new KeyService({
    dataDir,
    localDir,
    protector,
    native: noNative,
    sessionHours: () => 8,
    onChange: () => undefined,
    beforeLock: async () => vault?.beforeLock()
  })
  await keys.init()
  vault = new VaultService(dataDir, device, keys, clip, () => undefined)
  const deadlines = new DeadlineService(dataDir, device, () => undefined, () => undefined, syncCodec(keys, 'deadlines'))
  return { keys, vault, deadlines, dataDir }
}

async function allFiles(dir: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const texts = await Promise.all(
    entries.filter((e) => e.isFile()).map((e) => readFile(join(e.parentPath ?? (e as unknown as { path: string }).path, e.name), 'utf8'))
  )
  return texts.join('\n')
}

describe('cassaforte su due PC', () => {
  it('configura, cifra tutto su OneDrive e collega un secondo PC con la chiave di recupero', async () => {
    const a = await pc('pc1')
    expect(a.keys.setup).toBe('unconfigured')

    const recovery = await a.keys.create()
    await a.vault.opened()
    expect(a.keys.setup).toBe('ready')
    expect(a.keys.unlocked).toBe(true)

    const id = a.vault.save({ name: 'Gmail', username: 'io@example.com', password: 'S3greta!Davvero', url: 'mail.google.com', notes: '', intervalDays: 90, groupId: null })
    a.deadlines.save({ title: 'Bollo auto', date: '2027-01-31', recurrence: { unit: 'none', every: 1 }, leadDays: null, category: '', notes: '' })
    await a.vault.flush()
    await a.deadlines.flush()

    // Su OneDrive niente in chiaro: né password, né utente, né nomi, né scadenze.
    const onedrive = await allFiles(a.dataDir)
    for (const secret of ['S3greta!Davvero', 'io@example.com', 'Gmail', 'Bollo auto', recovery]) {
      expect(onedrive).not.toContain(secret)
    }

    // Chiusura: i segreti spariscono, i metadati restano per i promemoria.
    await a.keys.lock('test')
    a.vault.closed()
    expect(a.vault.list()[0]).toMatchObject({ name: 'Gmail' })
    expect(a.vault.list()[0]?.username).toBeUndefined()
    expect(() => a.vault.reveal(id)).toThrow('locked')

    // Secondo PC: vede che la cassaforte esiste e chiede la chiave di recupero.
    const b = await pc('pc2')
    expect(b.keys.setup).toBe('needsRecovery')
    await expect(b.keys.unlockWithRecovery('0000-0000-0000-0000-0000-0000-0000-0000')).rejects.toThrow()
    await b.keys.unlockWithRecovery(recovery)
    await b.vault.opened()
    await b.deadlines.load()
    expect(b.keys.setup).toBe('ready')
    expect(b.vault.reveal(id)).toBe('S3greta!Davvero')
    expect(b.deadlines.list().map((d) => d.title)).toEqual(['Bollo auto'])
  })

  it('nuova password: copia, storico e countdown azzerato', async () => {
    const a = await pc('pc1')
    await a.keys.create()
    await a.vault.opened()
    const id = a.vault.save({ name: 'Banca', username: 'me', password: 'vecchia-123', url: '', notes: '', intervalDays: 30, groupId: null }, '2027-01-01')
    expect(await a.vault.newPassword(id, { length: 24, symbols: true, avoidAmbiguous: true }, '2027-02-15')).toBe(true)
    const nuova = a.vault.reveal(id)!
    expect(nuova).toHaveLength(24)
    expect(copied.at(-1)).toBe(nuova)
    expect(a.vault.list()[0]).toMatchObject({ lastChanged: '2027-02-15', historyCount: 1 })

    // Modifica manuale della password: il countdown riparte
    a.vault.save({ id, name: 'Banca', username: 'me', password: 'a-mano-456', url: '', notes: '', intervalDays: 30, groupId: null }, '2027-03-01')
    expect(a.vault.list()[0]).toMatchObject({ lastChanged: '2027-03-01', historyCount: 2 })
    // Cambiare solo l'intervallo non tocca l'ultimo cambio
    a.vault.setInterval(id, 60)
    expect(a.vault.list()[0]).toMatchObject({ lastChanged: '2027-03-01', intervalDays: 60 })
  })

  it('non si può configurare due volte', async () => {
    const a = await pc('pc1')
    await a.keys.create()
    const b = await pc('pc2')
    await expect(b.keys.create()).rejects.toThrow('already-configured')
  })
})

describe('raccolte della cassaforte', () => {
  it('raggruppa per progetto; eliminare una raccolta non elimina le password', async () => {
    const a = await pc('pc1')
    const recovery = await a.keys.create()
    await a.vault.opened()
    const alfa = a.vault.saveGroup(undefined, 'Progetto Alfa', '#6366F1')
    const beta = a.vault.saveGroup(undefined, 'Progetto Beta', '#22B07D')
    const db = a.vault.save({ name: 'DB Alfa', username: 'admin', password: 'x1!Segreta', url: '', notes: '', intervalDays: 90, groupId: alfa })
    const vpn = a.vault.save({ name: 'VPN', username: 'me', password: 'y2!Segreta', url: '', notes: '', intervalDays: 90, groupId: null })

    expect(a.vault.data().groups.map((g) => g.name)).toEqual(['Progetto Alfa', 'Progetto Beta'])
    expect(a.vault.list().find((e) => e.id === db)?.groupId).toBe(alfa)

    expect(a.vault.move(vpn, beta)).toBe(true)
    expect(a.vault.move(vpn, 'inesistente')).toBe(false)
    a.vault.saveGroup(alfa, 'Alfa (cliente)', '#F97362')
    expect(a.vault.groupList()[0]).toMatchObject({ name: 'Alfa (cliente)', color: '#F97362' })

    expect(a.vault.removeGroup(alfa)).toBe(true)
    expect(a.vault.list().map((e) => [e.name, e.groupId])).toEqual([
      ['DB Alfa', null],
      ['VPN', beta]
    ])
    expect(a.vault.reveal(db)).toBe('x1!Segreta')

    // Su OneDrive i nomi delle raccolte sono cifrati; un secondo PC li vede dopo il collegamento.
    await a.vault.flush()
    expect(await allFiles(a.dataDir)).not.toContain('Progetto Beta')
    const b = await pc('pc2')
    await b.keys.unlockWithRecovery(recovery)
    await b.vault.opened()
    expect(b.vault.data().groups.map((g) => g.name)).toEqual(['Progetto Beta'])
    expect(b.vault.list().find((e) => e.name === 'VPN')?.groupId).toBe(beta)
  })

  it('le voci create prima delle raccolte risultano senza raccolta', async () => {
    const a = await pc('pc1')
    await a.keys.create()
    await a.vault.opened()
    const id = a.vault.meta.put({ name: 'Vecchia', intervalDays: 0, lastChanged: '2026-01-01', snoozedUntil: null }).id
    expect(a.vault.list().find((e) => e.id === id)?.groupId).toBeNull()
  })
})

describe('cartelle e sottocartelle', () => {
  it('crea sottocartelle, sposta, ed eliminando una cartella il contenuto sale di livello', async () => {
    const a = await pc('pc1')
    await a.keys.create()
    await a.vault.opened()
    const clienti = a.vault.saveGroup(undefined, 'Clienti', '#6366F1', null)
    const alfa = a.vault.saveGroup(undefined, 'Alfa', '#22B07D', clienti)
    const db = a.vault.saveGroup(undefined, 'Database', '#F59E0B', alfa)
    const pw = a.vault.save({ name: 'Postgres', username: 'admin', password: 'p!Ass123', url: '', notes: '', intervalDays: 90, groupId: alfa })

    expect(a.vault.moveGroup(clienti, db)).toBe(false) // ciclo
    expect(a.vault.moveGroup(db, null)).toBe(true)
    expect(a.vault.groupList().find((x) => x.id === db)?.parentId).toBeNull()
    expect(a.vault.moveGroup(db, alfa)).toBe(true)

    // Elimino "Alfa": "Database" e la password finiscono in "Clienti"
    expect(a.vault.removeGroup(alfa)).toBe(true)
    expect(a.vault.groupList().find((x) => x.id === db)?.parentId).toBe(clienti)
    expect(a.vault.list().find((e) => e.id === pw)?.groupId).toBe(clienti)
    expect(a.vault.reveal(pw)).toBe('p!Ass123')

    // Rinominare non cambia la posizione
    a.vault.saveGroup(db, 'DB', '#F59E0B')
    expect(a.vault.groupList().find((x) => x.id === db)).toMatchObject({ name: 'DB', parentId: clienti })
  })
})
