import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '../src/main/storage/atomic'
import { CollectionStore } from '../src/main/storage/collection'
import { resolveDataDir } from '../src/main/storage/paths'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dock-test-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('scrive il file e non lascia temporanei', async () => {
    const file = join(dir, 'a.json')
    await writeFileAtomic(file, 'uno')
    await writeFileAtomic(file, 'due')
    expect(await readFile(file, 'utf8')).toBe('due')
    expect(await readdir(dir)).toEqual(['a.json'])
  })

  it('regge scritture concorrenti sullo stesso file', async () => {
    const file = join(dir, 'b.json')
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(file, `v${i}`)))
    expect(await readFile(file, 'utf8')).toMatch(/^v\d+$/)
    expect(await readdir(dir)).toEqual(['b.json'])
  })
})

const schema = z.object({ title: z.string() })
const store = (deviceId: string, now?: () => number) =>
  new CollectionStore({ dir, name: 'test', device: { id: deviceId, name: deviceId }, schema, now, saveDelayMs: 0 })

describe('CollectionStore', () => {
  it("due PC scrivono file separati e ognuno vede le voci dell'altro", async () => {
    const pc1 = store('pc1')
    const pc2 = store('pc2')
    pc1.put({ id: 'x', title: 'da pc1' })
    pc2.put({ id: 'y', title: 'da pc2' })
    await Promise.all([pc1.flush(), pc2.flush()])
    expect((await readdir(dir)).sort()).toEqual(['pc1.json', 'pc2.json'])

    await pc1.load()
    expect(pc1.list().map((i) => i.title).sort()).toEqual(['da pc1', 'da pc2'])
  })

  it('le eliminazioni si propagano e le copie di conflitto di OneDrive vengono unite', async () => {
    let t = 1000
    const pc1 = store('pc1', () => t++)
    const item = pc1.put({ title: 'bollo' })
    await pc1.flush()
    // OneDrive ha creato una copia del file con il nome del PC
    await writeFile(join(dir, 'pc1-LAPTOP.json'), await readFile(join(dir, 'pc1.json')))

    const pc2 = store('pc2', () => t++)
    await pc2.load()
    expect(pc2.get(item.id)?.title).toBe('bollo')
    pc2.remove(item.id)
    await pc2.flush()

    await pc1.load()
    expect(pc1.get(item.id)).toBeUndefined()
    expect(pc1.takeConflicts()).toHaveLength(0)
  })

  it('ignora file rovinati senza cancellarli e scarta voci non valide', async () => {
    await writeFile(join(dir, 'rotto.json'), '{ non è json')
    await writeFile(
      join(dir, 'pc9.json'),
      JSON.stringify({
        format: 'dock-collection',
        version: 1,
        collection: 'test',
        deviceId: 'pc9',
        deviceName: 'pc9',
        writtenAt: 1,
        items: [
          { id: 'ok', title: 'valida', createdAt: 1, updatedAt: 1, updatedBy: 'pc9', rev: 'r1', hist: [] },
          { id: 'ko', title: 42, createdAt: 1, updatedAt: 1, updatedBy: 'pc9', rev: 'r2', hist: [] }
        ]
      })
    )
    const errors: string[] = []
    const s = new CollectionStore({
      dir,
      name: 'test',
      device: { id: 'pc1', name: 'pc1' },
      schema,
      onError: (_e, f) => errors.push(f ?? '')
    })
    await s.load()
    expect(s.list().map((i) => i.id)).toEqual(['ok'])
    expect(errors).toHaveLength(1)
    expect(await readdir(dir)).toContain('rotto.json')
  })
})

describe('resolveDataDir', () => {
  it('preferisce il OneDrive personale', () => {
    const r = resolveDataDir(
      '',
      { OneDriveConsumer: 'C:\\U\\OneDrive', OneDriveCommercial: 'C:\\U\\OneDrive - Ditta', OneDrive: 'C:\\U\\OneDrive - Ditta' },
      'C:\\L'
    )
    expect(r).toEqual({ path: join('C:\\U\\OneDrive', 'Dock'), kind: 'personal' })
  })

  it('riconosce il OneDrive aziendale', () => {
    const r = resolveDataDir('', { OneDriveCommercial: 'C:\\U\\OneDrive - Ditta', OneDrive: 'C:\\U\\OneDrive - Ditta' }, 'C:\\L')
    expect(r.kind).toBe('business')
  })

  it('usa la cartella scelta a mano o quella locale', () => {
    expect(resolveDataDir('D:\\Dati', {}, 'C:\\L').kind).toBe('custom')
    expect(resolveDataDir('', {}, 'C:\\L')).toEqual({ path: join('C:\\L', 'data'), kind: 'local' })
  })
})
