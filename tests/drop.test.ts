import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleDrop, type DropDeps } from '../src/main/drop'
import { isAbsoluteWinPath, type LinkOp } from '@shared/extras'
import type { BubbleRequest } from '../src/main/mascot'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pix-drop-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function setup() {
  const links: Array<{ kind: string; target: string }> = []
  const notes: string[] = []
  const bubbles: BubbleRequest[] = []
  const deps = {
    links: {
      store: { list: () => links },
      apply: async (op: LinkOp) => {
        if (op.op === 'save') links.push({ kind: op.kind, target: op.target })
        return { ok: true }
      }
    },
    notes: { apply: (op: { note: { body: string } }) => notes.push(op.note.body) },
    t: () => ((k: string) => k) as never,
    bubble: (req: BubbleRequest) => bubbles.push(req),
    happy: () => undefined,
    openPanel: () => undefined
  } as unknown as DropDeps
  return { deps, links, notes, bubbles }
}

describe('trascinare su Pix', () => {
  it('riconosce i percorsi assoluti di Windows', () => {
    expect(isAbsoluteWinPath(String.raw`C:\Users\x\a.pdf`)).toBe(true)
    expect(isAbsoluteWinPath(String.raw`\\server\share\a.txt`)).toBe(true)
    expect(isAbsoluteWinPath('a.pdf')).toBe(false)
    expect(isAbsoluteWinPath(String.raw`..\a`)).toBe(false)
  })

  it('file e cartelle diventano link, senza doppioni', async () => {
    const file = join(dir, 'Contratto.pdf')
    const folder = join(dir, 'Progetti')
    await writeFile(file, 'x')
    await mkdir(folder)
    const { deps, links, bubbles } = setup()
    expect(await handleDrop({ paths: [file, folder, join(dir, 'manca.txt')], text: '' }, deps)).toBe(true)
    expect(links).toEqual([
      { kind: 'app', target: file },
      { kind: 'folder', target: folder }
    ])
    expect(bubbles[0]!.text).toBe('drop.savedMany')
    await handleDrop({ paths: [file], text: '' }, deps)
    expect(links).toHaveLength(2)
    expect(bubbles[1]!.text).toBe('drop.already')
  })

  it('un indirizzo diventa un link, il testo una nota', async () => {
    const { deps, links, notes } = setup()
    await handleDrop({ paths: [], text: 'www.example.com/pagina' }, deps)
    expect(links).toEqual([{ kind: 'web', target: 'https://www.example.com/pagina' }])
    await handleDrop({ paths: [], text: 'Lista della spesa: latte, pane' }, deps)
    expect(notes).toEqual(['Lista della spesa: latte, pane'])
    expect(await handleDrop({ paths: [], text: '   ' }, deps)).toBe(false)
  })
})
