import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { ModelOption, ProviderStatus } from '@shared/chat'
import { DEFAULT_MODELS } from '@shared/chat'
import { AIError, type AIProvider, type AIRequest } from './provider'
import { log } from '../log'

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')

/**
 * Claude Code installato sul PC (lo stesso che usi da terminale, con il tuo
 * login). L'eseguibile incluso nell'SDK pesa centinaia di MB e non viene
 * distribuito con Dock: si usa solo in sviluppo se Claude Code non è installato.
 */
export function findClaudeCode(): string | null {
  const home = process.env.USERPROFILE ?? ''
  const candidates = [
    join(home, '.local', 'bin', 'claude.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'claude', 'claude.exe'),
    join(process.env.APPDATA ?? '', 'npm', 'claude.cmd')
  ]
  for (const c of candidates) if (c && existsSync(c)) return c
  try {
    const found = execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0]?.trim()
    return found && existsSync(found) ? found : null
  } catch {
    return null
  }
}

/**
 * Fornitore "abbonamento Claude": usa Claude Agent SDK (che include Claude
 * Code) con il login del tuo account claude.ai, senza API key.
 *
 * Configurazione minima e sicura: solo chat.
 * - nessuno strumento (tools: []), e canUseTool nega comunque tutto;
 * - nessun server MCP, nessuna impostazione/hook/CLAUDE.md dal disco;
 * - cartella di lavoro vuota e dedicata;
 * - sessioni non salvate nella cronologia di Claude Code;
 * - variabili ANTHROPIC_API_KEY / AUTH_TOKEN rimosse, così si usa l'abbonamento.
 */
export class ClaudeSubscriptionProvider implements AIProvider {
  readonly id = 'claude-subscription'
  readonly label = 'Claude (abbonamento)'
  private sdk: Promise<Sdk> | null = null
  private models: ModelOption[] | null = null

  private readonly executable: string | null

  constructor(
    private readonly workDir: string,
    private readonly allowBundled: boolean
  ) {
    this.executable = findClaudeCode()
    log.info(this.executable ? `Claude Code: ${this.executable}` : 'Claude Code non trovato sul PC')
  }

  get claudePath(): string | null {
    return this.executable
  }

  private load(): Promise<Sdk> {
    this.sdk ??= import('@anthropic-ai/claude-agent-sdk')
    return this.sdk
  }

  private env(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'dock/0.1' }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.CLAUDE_CODE_USE_BEDROCK
    delete env.CLAUDE_CODE_USE_VERTEX
    return env
  }

  private baseOptions(abortController: AbortController) {
    return {
      ...(this.executable ? { pathToClaudeCodeExecutable: this.executable } : {}),
      cwd: this.workDir,
      env: this.env(),
      abortController,
      tools: [] as string[],
      allowedTools: [] as string[],
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: [] as [],
      persistSession: false,
      maxTurns: 1,
      canUseTool: async () => ({ behavior: 'deny' as const, message: 'Dock: strumenti disattivati.' })
    }
  }

  /** Controlla il login senza consumare messaggi: avvia una sessione vuota e legge le informazioni dell'account. */
  async status(): Promise<ProviderStatus> {
    const base = { provider: this.id }
    if (!this.executable && !this.allowBundled) return { ...base, state: 'unavailable', detail: 'not-installed' }
    let sdk: Sdk
    try {
      await mkdir(this.workDir, { recursive: true })
      sdk = await this.load()
    } catch (err) {
      log.error('Agent SDK non caricabile', err)
      return { ...base, state: 'unavailable', detail: 'sdk' }
    }
    const abort = new AbortController()
    const idle = (async function* () {
      await new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve()))
    })() as AsyncIterable<never>
    const q = sdk.query({ prompt: idle, options: this.baseOptions(abort) })
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30_000))
    try {
      const info = await Promise.race([q.accountInfo(), timeout])
      try {
        const models = await Promise.race([q.supportedModels(), timeout])
        this.models = models.map((m) => ({ value: m.value, label: m.displayName ?? m.value }))
      } catch {
        // l'elenco dei modelli è facoltativo
      }
      const loggedIn = Boolean(info.email || info.subscriptionType || info.tokenSource)
      if (!loggedIn) return { ...base, state: 'not-logged-in' }
      return { ...base, state: 'ready', account: { email: info.email, subscription: info.subscriptionType } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('Verifica account Claude non riuscita', err)
      return /auth|login|credential/i.test(msg)
        ? { ...base, state: 'not-logged-in' }
        : { ...base, state: 'error', detail: msg.slice(0, 200) }
    } finally {
      abort.abort()
      try {
        q.close()
      } catch {
        // già chiusa
      }
    }
  }

  async listModels(): Promise<ModelOption[]> {
    return this.models ?? DEFAULT_MODELS.map((m) => ({ ...m }))
  }

  async send(req: AIRequest, onText: (text: string) => void, signal: AbortSignal): Promise<string> {
    await mkdir(this.workDir, { recursive: true })
    const sdk = await this.load()
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    signal.addEventListener('abort', onAbort)
    let text = ''
    try {
      const q = sdk.query({
        prompt: req.prompt,
        options: {
          ...this.baseOptions(abort),
          systemPrompt: req.systemPrompt,
          includePartialMessages: true,
          ...(req.model && req.model !== 'default' ? { model: req.model } : {})
        }
      })
      for await (const msg of q) {
        if (msg.type === 'stream_event') {
          const ev = msg.event
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            text += ev.delta.text
            onText(text)
          }
        } else if (msg.type === 'assistant') {
          if (msg.error) throw new AIError(msg.error)
          // Se lo streaming parziale non è arrivato, usa il messaggio completo.
          if (!text) {
            const full = msg.message.content
              .map((b) => (b.type === 'text' ? b.text : ''))
              .join('')
            if (full) {
              text = full
              onText(text)
            }
          }
        } else if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            if (!text && msg.result) {
              text = msg.result
              onText(text)
            }
          } else if (!signal.aborted) {
            throw new AIError(msg.subtype)
          }
        }
      }
      return text
    } catch (err) {
      if (signal.aborted) return text
      if (err instanceof AIError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      if (/auth|login|401|credential/i.test(msg)) throw new AIError('authentication_failed')
      log.error('Chat AI non riuscita', err)
      throw new AIError('unknown')
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}
