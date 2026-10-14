import { z } from 'zod'
import type { SyncItem } from './sync'

/** Chat AI: conversazioni salvate (cifrate con la sync key) e operazioni. */

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(200_000),
  at: z.number(),
  /** Codice d'errore se la risposta non è arrivata. */
  error: z.string().max(100).optional()
})
export type ChatMessage = z.infer<typeof chatMessageSchema>

export const conversationSchema = z.object({
  title: z.string().max(200),
  model: z.string().max(100),
  messages: z.array(chatMessageSchema).max(2000)
})
export type Conversation = z.infer<typeof conversationSchema>
export type ConversationItem = SyncItem<Conversation>

/** Modelli proposti: alias di Claude Code, sempre aggiornati all'ultima versione. */
export const DEFAULT_MODELS = [
  { value: 'default', label: 'Predefinito' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' }
] as const

export interface ModelOption {
  value: string
  label: string
}

export type ProviderState = 'checking' | 'ready' | 'not-logged-in' | 'unavailable' | 'error'

export interface ProviderStatus {
  provider: string
  state: ProviderState
  account?: { email?: string; subscription?: string }
  detail?: string
}

export interface ChatState {
  status: ProviderStatus
  models: ModelOption[]
  /** Conversazioni con una risposta in corso. */
  streaming: string[]
}

export interface ChatStreamEvent {
  id: string
  /** Testo arrivato finora (completo, non solo l'ultimo pezzo). */
  text: string
  done: boolean
  error?: string
}

const id = z.string().min(1).max(200)

export const chatOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('new'), model: z.string().max(100).optional() }),
  z.object({ op: z.literal('rename'), id, title: z.string().trim().min(1).max(200) }),
  z.object({ op: z.literal('remove'), id }),
  z.object({ op: z.literal('setModel'), id, model: z.string().max(100) }),
  z.object({ op: z.literal('send'), id, text: z.string().trim().min(1).max(100_000) }),
  z.object({ op: z.literal('stop'), id }),
  z.object({ op: z.literal('checkStatus') }),
  z.object({ op: z.literal('openLogin') }),
  z.object({ op: z.literal('openDocs') }),
  z.object({ op: z.literal('copy'), text: z.string().max(200_000) })
])
export type ChatOp = z.infer<typeof chatOpSchema>
export type ChatOpResult = { ok: true; value?: string } | { ok: false; error: string }

/** Titolo automatico dal primo messaggio. */
export function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

/**
 * Le conversazioni non vengono salvate nella cronologia di Claude Code: a ogni
 * messaggio si invia lo storico recente come contesto, entro un limite di caratteri.
 */
export function buildPrompt(history: ChatMessage[], next: string, labels: { user: string; assistant: string }, maxChars = 60_000): string {
  const turns: string[] = []
  let size = next.length
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!
    if (m.error) continue
    const block = `${m.role === 'user' ? labels.user : labels.assistant}:\n${m.text}`
    if (size + block.length > maxChars) break
    turns.unshift(block)
    size += block.length
  }
  if (turns.length === 0) return next
  return `<conversazione_precedente>\n${turns.join('\n\n')}\n</conversazione_precedente>\n\n${next}`
}
