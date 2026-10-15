import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPrompt, titleFrom, type ChatStreamEvent } from '@shared/chat'
import { ChatService } from '../src/main/ai/chatService'
import { AIError, type AIProvider, type AIRequest } from '../src/main/ai/provider'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pix-chat-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('prompt e titoli', () => {
  it('include lo storico recente come contesto, entro il limite', () => {
    const labels = { user: 'Utente', assistant: 'Assistente' }
    expect(buildPrompt([], 'ciao', labels)).toBe('ciao')
    const history = [
      { role: 'user' as const, text: 'prima domanda', at: 1 },
      { role: 'assistant' as const, text: 'prima risposta', at: 2 },
      { role: 'assistant' as const, text: 'errore', at: 3, error: 'unknown' }
    ]
    const p = buildPrompt(history, 'seconda', labels)
    expect(p).toContain('Utente:\nprima domanda')
    expect(p).toContain('Assistente:\nprima risposta')
    expect(p).not.toContain('errore')
    expect(p.endsWith('seconda')).toBe(true)
    expect(buildPrompt([{ role: 'user', text: 'x'.repeat(100), at: 1 }], 'nuova', labels, 50)).toBe('nuova')
  })

  it('crea il titolo dalla prima riga', () => {
    expect(titleFrom('Come si fa una pizza?\naltro')).toBe('Come si fa una pizza?')
    expect(titleFrom('a'.repeat(80))).toHaveLength(58)
  })
})

function fakeProvider(behaviour: (req: AIRequest, onText: (t: string) => void, signal: AbortSignal) => Promise<string>): AIProvider {
  return {
    id: 'fake',
    label: 'Fake',
    status: async () => ({ provider: 'fake', state: 'ready' }),
    listModels: async () => [{ value: 'default', label: 'Default' }],
    send: behaviour
  }
}

function service(provider: AIProvider) {
  const events: ChatStreamEvent[] = []
  const thinking: boolean[] = []
  const chat = new ChatService({
    dataDir: dir,
    device: { id: 'pc1-0000-0000', name: 'pc1' },
    codec: { encode: (s) => s, decode: (s) => s },
    onError: () => undefined,
    provider,
    claudePath: () => null,
    defaultModel: () => 'default',
    systemPrompt: () => 'sistema',
    labels: () => ({ user: 'Utente', assistant: 'Assistente', newChat: 'Nuova chat' }),
    onThinking: (v) => thinking.push(v),
    onStream: (ev) => events.push(ev),
    onState: () => undefined,
    copy: () => undefined
  })
  const done = () => new Promise<void>((resolve) => {
    const check = () => (events.some((e) => e.done) ? resolve() : setTimeout(check, 5))
    check()
  })
  return { chat, events, thinking, done }
}

describe('ChatService', () => {
  it('invia, riceve in streaming e salva la risposta; Pix pensa nel frattempo', async () => {
    const seen: AIRequest[] = []
    const { chat, events, thinking, done } = service(
      fakeProvider(async (req, onText) => {
        seen.push(req)
        onText('Cia')
        onText('Ciao!')
        return 'Ciao!'
      })
    )
    const created = await chat.apply({ op: 'new' })
    const id = created.ok ? created.value! : ''
    expect(await chat.apply({ op: 'send', id, text: 'Saluta' })).toEqual({ ok: true })
    await done()
    const conv = chat.list()[0]!
    expect(conv.title).toBe('Saluta')
    expect(conv.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Saluta'],
      ['assistant', 'Ciao!']
    ])
    expect(events.at(-1)).toMatchObject({ id, text: 'Ciao!', done: true })
    expect(thinking).toEqual([true, false])
    expect(seen[0]).toMatchObject({ systemPrompt: 'sistema', model: 'default', prompt: 'Saluta' })
  })

  it('segnala il login scaduto e conserva il messaggio dell’utente', async () => {
    const { chat, done } = service(
      fakeProvider(async () => {
        throw new AIError('authentication_failed')
      })
    )
    const created = await chat.apply({ op: 'new' })
    const id = created.ok ? created.value! : ''
    await chat.apply({ op: 'send', id, text: 'ciao' })
    await done()
    expect(chat.list()[0]!.messages.at(-1)).toMatchObject({ role: 'assistant', error: 'authentication_failed' })
    expect((await chat.state()).status.state).toBe('not-logged-in')
  })

  it('stop interrompe la risposta e tiene il testo arrivato', async () => {
    const { chat, done } = service(
      fakeProvider(
        (_req, onText, signal) =>
          new Promise((resolve) => {
            onText('mezza risp')
            signal.addEventListener('abort', () => resolve('mezza risp'))
          })
      )
    )
    const created = await chat.apply({ op: 'new' })
    const id = created.ok ? created.value! : ''
    await chat.apply({ op: 'send', id, text: 'lunga' })
    expect((await chat.apply({ op: 'send', id, text: 'altra' })).ok).toBe(false) // una risposta alla volta
    await chat.apply({ op: 'stop', id })
    await done()
    expect(chat.list()[0]!.messages.at(-1)).toMatchObject({ text: 'mezza risp', error: 'stopped' })
  })
})
