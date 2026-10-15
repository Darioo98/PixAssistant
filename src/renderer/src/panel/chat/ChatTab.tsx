import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatState, ConversationItem } from '@shared/chat'
import { RowMenu, DeleteButton } from '../RowMenu'
import { Markdown } from './Markdown'
import { loadSelected, saveSelected, useChat } from './useChat'
import './chat.css'

const QUICK = ['summarize', 'translate', 'email', 'fix'] as const

export function ChatTab() {
  const { t } = useTranslation()
  const { items, state, streams } = useChat()
  const [selected, setSelected] = useState<string | null>(loadSelected)

  const current = items?.find((c) => c.id === selected) ?? items?.[0] ?? null

  useEffect(() => {
    if (current && current.id !== selected) setSelected(current.id)
  }, [current, selected])

  const select = (id: string) => {
    setSelected(id)
    saveSelected(id)
  }

  const create = async () => {
    const r = await window.pix.chat.apply({ op: 'new' })
    if (r.ok && r.value) select(r.value)
  }

  if (!items || !state) return null
  if (state.status.state !== 'ready') return <Connect state={state} />

  return (
    <div className="chat">
      <div className="chat-bar">
        <select
          className="chat-select"
          value={current?.id ?? ''}
          aria-label={t('ai.chat.conversations')}
          onChange={(e) => select(e.target.value)}
        >
          {items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => void create()}>
          + {t('ai.chat.new')}
        </button>
        {current && <ConversationMenu conv={current} />}
      </div>
      {current ? (
        <Conversation conv={current} state={state} streaming={streams[current.id]} />
      ) : (
        <div className="chat-empty">
          <p>{t('ai.chat.empty')}</p>
          <button className="btn primary" onClick={() => void create()}>
            + {t('ai.chat.new')}
          </button>
        </div>
      )}
    </div>
  )
}

function ConversationMenu({ conv }: { conv: ConversationItem }) {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(conv.title)
  if (renaming) {
    return (
      <form
        className="rename"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) void window.pix.chat.apply({ op: 'rename', id: conv.id, title: title.trim() })
          setRenaming(false)
        }}
      >
        <input autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onBlur={() => setRenaming(false)} />
      </form>
    )
  }
  return (
    <RowMenu label={t('ai.chat.more')}>
      <button
        onClick={() => {
          setTitle(conv.title)
          setRenaming(true)
        }}
      >
        {t('ai.chat.rename')}
      </button>
      <DeleteButton onConfirm={() => void window.pix.chat.apply({ op: 'remove', id: conv.id })} />
    </RowMenu>
  )
}

function Conversation({ conv, state, streaming }: { conv: ConversationItem; state: ChatState; streaming?: string }) {
  const { t, i18n } = useTranslation()
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const busy = state.streaming.includes(conv.id)

  // Scorre in fondo quando arrivano messaggi o testo in streaming.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conv.messages.length, streaming, conv.id])

  const send = () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    void window.pix.chat.apply({ op: 'send', id: conv.id, text })
  }

  const errorText = (code: string) => {
    const key = `ai.errors.${code}`
    return i18n.exists(key) ? t(key) : t('ai.errors.unknown')
  }

  return (
    <>
      <div className="messages" ref={listRef}>
        {conv.messages.length === 0 && !busy && <p className="chat-hint">{t('ai.chat.empty')}</p>}
        {conv.messages.map((m, i) => (
          <div key={`${m.at}-${i}`} className={`msg ${m.role}`}>
            {m.role === 'user' ? <p className="msg-user-text">{m.text}</p> : m.text && <Markdown text={m.text} />}
            {m.error && <p className="msg-error">{errorText(m.error)}</p>}
            {m.role === 'assistant' && m.text && <CopyAnswer text={m.text} />}
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            {streaming ? <Markdown text={streaming} /> : <p className="chat-hint">{t('ai.chat.thinking')}</p>}
          </div>
        )}
      </div>

      <div className="composer">
        <div className="quick">
          {QUICK.map((q) => (
            <button
              key={q}
              className="chip"
              onClick={() => {
                setDraft(t(`ai.quickPrompts.${q}`) + draft)
                inputRef.current?.focus()
              }}
            >
              {t(`ai.quick.${q}`)}
            </button>
          ))}
          <select
            className="model"
            value={conv.model}
            aria-label={t('ai.chat.model')}
            title={t('ai.chat.model')}
            onChange={(e) => void window.pix.chat.apply({ op: 'setModel', id: conv.id, model: e.target.value })}
          >
            {state.models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="composer-row">
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            placeholder={t('ai.chat.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          {busy ? (
            <button className="btn" onClick={() => void window.pix.chat.apply({ op: 'stop', id: conv.id })}>
              {t('ai.chat.stop')}
            </button>
          ) : (
            <button className="btn primary" disabled={!draft.trim()} onClick={send}>
              {t('ai.chat.send')}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function CopyAnswer({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="msg-copy"
      onClick={() =>
        void window.pix.chat.apply({ op: 'copy', text }).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {copied ? t('ai.chat.copied') : t('ai.chat.copyAnswer')}
    </button>
  )
}

/** Guida al collegamento dell'abbonamento Claude (login o installazione di Claude Code). */
function Connect({ state }: { state: ChatState }) {
  const { t } = useTranslation()
  const s = state.status.state
  const recheck = () => void window.pix.chat.apply({ op: 'checkStatus' })
  if (s === 'checking') return <p className="chat-hint center">{t('ai.connect.checking')}</p>
  if (s === 'unavailable') {
    return (
      <div className="vault-card">
        <h2>{t('ai.connect.unavailableTitle')}</h2>
        <p>{t('ai.connect.unavailableText')}</p>
        <button className="btn primary" onClick={() => void window.pix.chat.apply({ op: 'openDocs' })}>
          {t('ai.connect.openDocs')}
        </button>
        <button className="btn" onClick={recheck}>
          {t('ai.connect.recheck')}
        </button>
      </div>
    )
  }
  return (
    <div className="vault-card">
      <h2>{s === 'error' ? t('ai.connect.errorTitle') : t('ai.connect.notLoggedInTitle')}</h2>
      <p>{t('ai.connect.notLoggedInText')}</p>
      {state.status.detail && <p className="hint">{state.status.detail}</p>}
      <button className="btn primary" onClick={() => void window.pix.chat.apply({ op: 'openLogin' })}>
        {t('ai.connect.openLogin')}
      </button>
      <button className="btn" onClick={recheck}>
        {t('ai.connect.recheck')}
      </button>
    </div>
  )
}
