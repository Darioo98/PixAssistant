/** Evento lanciato quando elimini qualcosa: Pix se lo mangia. */
export const DELETED_EVENT = 'pix:deleted'

export interface DeletedDetail {
  /** Punto dello schermo da cui parte il boccone. */
  x: number
  y: number
  /** Prime parole di ciò che è stato eliminato, mostrate sul foglietto. */
  text: string
}

/** Segnala a Pix un'eliminazione avvenuta in quell'elemento. */
export function notifyDeleted(el: Element | null): void {
  const r = el?.getBoundingClientRect()
  const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  window.dispatchEvent(new CustomEvent<DeletedDetail | null>(DELETED_EVENT, { detail: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, text } : null }))
}
