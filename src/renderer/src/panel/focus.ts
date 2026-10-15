import type { TabId } from '@shared/ipc'

/**
 * Apertura mirata di una sezione (dalla ricerca globale o da un comando):
 * la sezione legge la richiesta quando si monta. Il pannello rimonta il
 * contenuto a ogni richiesta, così vale anche se la sezione era già aperta.
 */
export type FocusRequest =
  | { tab: 'notes'; noteId?: string; segment?: 'notes' | 'todos' }
  | { tab: 'vault'; query: string }
  | { tab: Exclude<TabId, 'notes' | 'vault'> }

export const FOCUS_EVENT = 'pix:focus'
/** Apre la ricerca globale (dettaglio: testo iniziale). */
export const SEARCH_EVENT = 'pix:search'

let pending: FocusRequest | null = null

export function requestFocus(req: FocusRequest): void {
  pending = req
  window.pix.openPanel(req.tab)
  window.dispatchEvent(new Event(FOCUS_EVENT))
}

/** Richiesta in attesa per questa sezione (la consuma). */
export function takeFocus<T extends FocusRequest['tab']>(tab: T): Extract<FocusRequest, { tab: T }> | null {
  if (!pending || pending.tab !== tab) return null
  const req = pending as Extract<FocusRequest, { tab: T }>
  pending = null
  return req
}

export function openSearch(query = ''): void {
  window.dispatchEvent(new CustomEvent(SEARCH_EVENT, { detail: query }))
}
