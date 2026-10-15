import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleDrop, type DropDeps } from '../src/main/drop'
import { isAbsoluteWinPath, type LinkOp } from '@shared/extras'
import type { BubbleRequest } from '../src/main/mascot'
import type { Attachment } from '../src/main/attachments'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pix-drop-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Aspetta che la condizione diventi vera (le scelte partono in modo asincrono). */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10))
}

function setup() {
  const links: Array<{ kind: string; target: string }> = []
  const notes: string[] = []
  const bubbles: BubbleRequest[] = []
  const analyzed: Array<{ files: Attachment[]; prompt: string }> = []
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
    openPanel: () => undefined,
    analyze: async (files: Attachment[], prompt: string) => {
      analyzed.push({ files, prompt })
      return true
    }
  } as unknown as DropDeps
  return { deps, links, notes, bubbles, analyzed }
}

describe('trascinare su Pix', () => {
  it('riconosce i percorsi assoluti di Windows', () => {
    expect(isAbsoluteWinPath(String.raw`C:\Users\x\a.pdf`)).toBe(true)
    expect(isAbsoluteWinPath(String.raw`\\server\share\a.txt`)).toBe(true)
    expect(isAbsoluteWinPath('a.pdf')).toBe(false)
    expect(isAbsoluteWinPath(String.raw`..\a`)).toBe(false)
  })

  it('chiede cosa fare: salvare nei Link oppure analizzare in chat', async () => {
    const file = join(dir, 'Contratto.txt')
    const folder = join(dir, 'Progetti')
    await writeFile(file, 'Scadenza: 31/12')
    await mkdir(folder)
    const { deps, links, bubbles, analyzed } = setup()
    expect(await handleDrop({ paths: [file, folder, join(dir, 'manca.txt')], text: '' }, deps)).toBe(true)
    expect(links).toEqual([]) // niente salvato prima della scelta
    expect(bubbles[0]!.actions!.map((a) => a.id)).toEqual(['save', 'analyze'])
    bubbles[0]!.onOutcome!({ kind: 'action', actionId: 'save' })
    await until(() => bubbles.length > 1)
    expect(links).toEqual([
      { kind: 'app', target: file },
      { kind: 'folder', target: folder }
    ])
    await handleDrop({ paths: [file], text: '' }, deps)
    bubbles.at(-1)!.onOutcome!({ kind: 'action', actionId: 'analyze' })
    await until(() => analyzed.length > 0)
    expect(analyzed[0]).toMatchObject({ files: [{ name: 'Contratto.txt', kind: 'text', text: 'Scadenza: 31/12' }] })
  })

  it('un file che la chat non sa leggere si può solo salvare', async () => {
    const file = join(dir, 'setup.exe')
    await writeFile(file, 'x')
    const { deps, bubbles } = setup()
    await handleDrop({ paths: [file], text: '' }, deps)
    expect(bubbles[0]!.actions!.map((a) => a.id)).toEqual(['save'])
  })

  it('il testo diventa una nota oppure va in chat; un indirizzo un link', async () => {
    const { deps, links, notes, bubbles, analyzed } = setup()
    await handleDrop({ paths: [], text: 'www.example.com/pagina' }, deps)
    bubbles[0]!.onOutcome!({ kind: 'action', actionId: 'save' })
    await until(() => links.length > 0)
    expect(links).toEqual([{ kind: 'web', target: 'https://www.example.com/pagina' }])
    await handleDrop({ paths: [], text: 'Lista della spesa: latte, pane' }, deps)
    bubbles.at(-1)!.onOutcome!({ kind: 'action', actionId: 'note' })
    expect(notes).toEqual(['Lista della spesa: latte, pane'])
    await handleDrop({ paths: [], text: 'Testo da capire' }, deps)
    bubbles.at(-1)!.onOutcome!({ kind: 'action', actionId: 'analyze' })
    expect(analyzed.at(-1)!.files[0]).toMatchObject({ kind: 'text', text: 'Testo da capire' })
    expect(await handleDrop({ paths: [], text: '   ' }, deps)).toBe(false)
  })
})
