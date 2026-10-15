import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { shell } from 'electron'
import { CollectionStore, type Codec, type DeviceInfo } from '../storage/collection'
import {
  buildPrompt,
  conversationSchema,
  titleFrom,
  type ChatMessage,
  type ChatOp,
  type ChatOpResult,
  type ChatState,
  type ChatStreamEvent,
  type Conversation,
  type ConversationItem,
  type ProviderStatus
} from '@shared/chat'
import { AIError, type AIProvider } from './provider'
import { log } from '../log'
import type { Attachment } from '../attachments'

const STREAM_THROTTLE_MS = 50

export interface ChatDeps {
  dataDir: string
  device: DeviceInfo
  codec: Codec
  onError: (err: unknown, file?: string) => void
  provider: AIProvider
  /** Percorso di Claude Code per aprire il login nel terminale. */
  claudePath: () => string | null
  defaultModel: () => string
  systemPrompt: () => string
  labels: () => { user: string; assistant: string; newChat: string }
  /** Pix va in "pensa" mentre l'AI risponde. */
  onThinking: (thinking: boolean) => void
  onStream: (ev: ChatStreamEvent) => void
  onState: () => void
  copy: (text: string) => void
}

/** Conversazioni salvate (cifrate con la sync key) e invio dei messaggi al fornitore AI. */
export class ChatService {
  readonly store: CollectionStore<Conversation>
  private status: ProviderStatus
  private running = new Map<string, AbortController>()
  /** Documenti allegati alle conversazioni (solo in memoria, mai salvati né sincronizzati). */
  private files = new Map<string, Attachment[]>()

  constructor(private readonly deps: ChatDeps) {
    this.status = { provider: deps.provider.id, state: 'checking' }
    this.store = new CollectionStore<Conversation>({
      dir: join(deps.dataDir, 'chats'),
      name: 'chats',
      device: deps.device,
      schema: conversationSchema,
      codec: deps.codec,
      onError: deps.onError
    })
  }

  load(): Promise<void> {
    return this.store.load()
  }

  list(): ConversationItem[] {
    return this.store.list().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async state(): Promise<ChatState> {
    return { status: this.status, models: await this.deps.provider.listModels(), streaming: [...this.running.keys()] }
  }

  async checkStatus(): Promise<void> {
    this.status = { provider: this.deps.provider.id, state: 'checking' }
    this.deps.onState()
    this.status = await this.deps.provider.status()
    log.info(`Stato AI: ${this.status.state}`)
    this.deps.onState()
  }

  async apply(op: ChatOp): Promise<ChatOpResult> {
    switch (op.op) {
      case 'new': {
        const item = this.store.put({ title: this.deps.labels().newChat, model: op.model ?? this.deps.defaultModel(), messages: [] })
        return { ok: true, value: item.id }
      }
      case 'rename':
        return this.update(op.id, (c) => ({ ...c, title: op.title }))
      case 'setModel':
        return this.update(op.id, (c) => ({ ...c, model: op.model }))
      case 'remove':
        this.running.get(op.id)?.abort()
        this.files.delete(op.id)
        return this.store.remove(op.id) ? { ok: true } : { ok: false, error: 'not-found' }
      case 'stop':
        this.running.get(op.id)?.abort()
        return { ok: true }
      case 'send':
        return this.send(op.id, op.text)
      case 'checkStatus':
        void this.checkStatus()
        return { ok: true }
      case 'openLogin':
        return this.openLogin()
      case 'openDocs':
        void shell.openExternal('https://docs.claude.com/en/docs/claude-code/overview')
        return { ok: true }
      case 'copy':
        this.deps.copy(op.text)
        return { ok: true }
    }
  }

  /**
   * Nuova conversazione su uno o più documenti (trascinati su Pix): i file
   * restano in memoria per le domande successive finché l'app è aperta.
   */
  async startWithAttachments(files: Attachment[], text: string, title: string): Promise<string | null> {
    const item = this.store.put({ title, model: this.deps.defaultModel(), messages: [] })
    this.files.set(item.id, files)
    const r = await this.send(item.id, text)
    return r.ok ? item.id : null
  }

  private async send(id: string, text: string): Promise<ChatOpResult> {
    const conv = this.store.get(id)
    if (!conv) return { ok: false, error: 'not-found' }
    if (this.running.has(id)) return { ok: false, error: 'busy' }

    const history = conv.messages
    const files = this.files.get(id)
    // I nomi dei file compaiono sul primo messaggio che li accompagna.
    const attached = files && !history.some((m) => m.attachments?.length) ? files.map((f) => ({ name: f.name, kind: f.kind })) : undefined
    const user: ChatMessage = { role: 'user', text, at: Date.now(), ...(attached ? { attachments: attached } : {}) }
    const title = history.length === 0 ? titleFrom(text) || conv.title : conv.title
    this.store.put({ ...strip(conv), title, messages: [...history, user], id })

    const abort = new AbortController()
    this.running.set(id, abort)
    this.deps.onThinking(true)
    this.deps.onState()

    let last = 0
    let pending: NodeJS.Timeout | null = null
    let latest = ''
    const emit = (done: boolean, error?: string) => this.deps.onStream({ id, text: latest, done, error })

    // La risposta arriva in background: il renderer riceve lo streaming via eventi.
    void (async () => {
      let reply: ChatMessage
      try {
        const answer = await this.deps.provider.send(
          {
            prompt: buildPrompt(history, text, this.deps.labels()),
            systemPrompt: this.deps.systemPrompt(),
            model: conv.model,
            ...(files ? { attachments: files } : {})
          },
          (t) => {
            latest = t
            const now = Date.now()
            if (now - last >= STREAM_THROTTLE_MS) {
              last = now
              emit(false)
            } else if (!pending) {
              pending = setTimeout(() => {
                pending = null
                last = Date.now()
                emit(false)
              }, STREAM_THROTTLE_MS)
            }
          },
          abort.signal
        )
        latest = answer
        reply = { role: 'assistant', text: answer, at: Date.now(), ...(abort.signal.aborted ? { error: 'stopped' } : {}) }
      } catch (err) {
        const code = err instanceof AIError ? err.code : 'unknown'
        if (code === 'authentication_failed') this.status = { provider: this.deps.provider.id, state: 'not-logged-in' }
        reply = { role: 'assistant', text: latest, at: Date.now(), error: code }
      } finally {
        if (pending) clearTimeout(pending)
        this.running.delete(id)
        if (this.running.size === 0) this.deps.onThinking(false)
      }
      const current = this.store.get(id)
      if (current) this.store.put({ ...strip(current), messages: [...current.messages, reply], id })
      emit(true, reply.error)
      this.deps.onState()
    })()

    return { ok: true }
  }

  /**
   * Apre un terminale con Claude Code: lì si digita /login per collegare
   * l'account claude.ai (abbonamento Pro/Max). Pix non vede mai le credenziali.
   */
  private openLogin(): ChatOpResult {
    const claude = this.deps.claudePath()
    if (!claude) return { ok: false, error: 'not-installed' }
    spawn('cmd.exe', ['/c', 'start', '"Claude Code"', 'cmd', '/k', `"${claude}"`], {
      detached: true,
      windowsHide: false,
      windowsVerbatimArguments: true,
      stdio: 'ignore'
    }).unref()
    return { ok: true }
  }

  private update(id: string, fn: (c: Conversation) => Conversation): ChatOpResult {
    const c = this.store.get(id)
    if (!c) return { ok: false, error: 'not-found' }
    this.store.put({ ...fn(strip(c)), id })
    return { ok: true }
  }

  stopAll(): void {
    for (const a of this.running.values()) a.abort()
  }

  flush(): Promise<void> {
    return this.store.flush()
  }
}

function strip(c: Conversation): Conversation {
  return { title: c.title, model: c.model, messages: c.messages }
}
