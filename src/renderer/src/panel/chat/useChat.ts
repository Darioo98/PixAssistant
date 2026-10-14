import { useEffect, useState } from 'react'
import type { ChatState, ConversationItem } from '@shared/chat'

/** Conversazioni, stato del fornitore e risposte in streaming. */
export function useChat() {
  const [items, setItems] = useState<ConversationItem[] | null>(null)
  const [state, setState] = useState<ChatState | null>(null)
  const [streams, setStreams] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    const offs = [
      window.dock.chat.onChange((next) => alive && setItems(next)),
      window.dock.chat.onState((s) => alive && setState(s)),
      window.dock.chat.onStream((ev) =>
        setStreams((prev) => {
          const next = { ...prev }
          if (ev.done) delete next[ev.id]
          else next[ev.id] = ev.text
          return next
        })
      )
    ]
    void window.dock.chat.list().then((l) => alive && setItems(l))
    void window.dock.chat.state().then((s) => alive && s && setState(s))
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
  }, [])

  return { items, state, streams }
}

const SELECTED_KEY = 'dock.chat.selected'

export function loadSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

export function saveSelected(id: string | null): void {
  try {
    if (id) localStorage.setItem(SELECTED_KEY, id)
    else localStorage.removeItem(SELECTED_KEY)
  } catch {
    // preferenza non essenziale
  }
}

/** Domanda veloce (da Home): crea una conversazione, invia e apre la Chat. */
export async function quickAsk(text: string): Promise<void> {
  const created = await window.dock.chat.apply({ op: 'new' })
  if (!created.ok || !created.value) return
  saveSelected(created.value)
  await window.dock.chat.apply({ op: 'send', id: created.value, text })
  window.dock.openPanel('chat')
}
