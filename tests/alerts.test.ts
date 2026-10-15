import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AlertEngine, type AlertCandidate } from '../src/main/alerts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pix-alerts-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const candidate = (key: string): AlertCandidate => ({
  key,
  category: 'Scadenze',
  title: key,
  text: `Avviso ${key}`,
  actions: [],
  onAction: () => undefined,
  onOpen: () => undefined
})

function setup(keys: () => string[], opts: { quiet?: () => boolean; now?: () => Date } = {}) {
  const toasts: string[] = []
  const bubbles: string[] = []
  const engine = new AlertEngine({
    localDir: dir,
    sources: [() => keys().map(candidate)],
    isQuiet: opts.quiet ?? (() => false),
    toast: (title) => toasts.push(title),
    bubble: (c) => bubbles.push(c.text),
    summary: (count) => ({ category: 'Avvisi', title: 'Pix', text: `Hai ${count} avvisi`, openLabel: 'Apri' }),
    openSummary: () => undefined,
    now: opts.now
  })
  return { engine, toasts, bubbles }
}

describe('AlertEngine', () => {
  it('mostra un avviso al giorno per voce, anche dopo un riavvio', async () => {
    let now = new Date(2027, 0, 10, 9)
    const first = setup(() => ['a', 'b'], { now: () => now })
    await first.engine.init()
    expect(await first.engine.run()).toBe(2)
    expect(first.toasts).toEqual(['a', 'b'])
    expect(await first.engine.run()).toBe(0)

    // Riavvio dell'app lo stesso giorno: nessun duplicato
    const second = setup(() => ['a', 'b'], { now: () => now })
    await second.engine.init()
    expect(await second.engine.run()).toBe(0)

    // Il giorno dopo l'avviso torna
    now = new Date(2027, 0, 11, 9)
    expect(await second.engine.run()).toBe(2)
  })

  it('recupera gli avvisi persi a PC spento', async () => {
    const { engine, bubbles } = setup(() => ['scaduta'], { now: () => new Date(2027, 0, 10, 8) })
    await engine.init()
    await engine.run()
    expect(bubbles).toEqual(['Avviso scaduta'])
  })

  it('trattiene gli avvisi in pausa / non disturbare e li mostra dopo', async () => {
    let quiet = true
    const { engine, toasts } = setup(() => ['a'], { quiet: () => quiet })
    await engine.init()
    expect(await engine.run()).toBe(0)
    quiet = false
    expect(await engine.run()).toBe(1)
    expect(toasts).toEqual(['a'])
  })

  it('con molti avvisi ne mostra uno riassuntivo', async () => {
    const { engine, toasts, bubbles } = setup(() => ['a', 'b', 'c', 'd', 'e'])
    await engine.init()
    expect(await engine.run()).toBe(5)
    expect(toasts).toEqual(['Pix'])
    expect(bubbles).toEqual(['Hai 5 avvisi'])
  })
})
