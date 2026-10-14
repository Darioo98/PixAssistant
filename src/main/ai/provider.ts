import type { ModelOption, ProviderStatus } from '@shared/chat'

/**
 * Interfaccia comune dei fornitori di AI. Oggi c'è solo l'abbonamento Claude
 * (tramite Claude Code / Agent SDK); in futuro: API Anthropic con key,
 * OpenAI, Google Gemini, modelli locali via Ollama. Le eventuali API key
 * andranno cifrate con safeStorage (DPAPI) e restare solo nel processo main.
 */
export interface AIRequest {
  prompt: string
  systemPrompt: string
  model: string
}

export interface AIProvider {
  readonly id: string
  readonly label: string
  /** Verifica che il fornitore sia utilizzabile (login, installazione…). */
  status(): Promise<ProviderStatus>
  listModels(): Promise<ModelOption[]>
  /** Risposta in streaming: `onText` riceve ogni volta il testo completo arrivato finora. */
  send(req: AIRequest, onText: (text: string) => void, signal: AbortSignal): Promise<string>
}

export class AIError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
