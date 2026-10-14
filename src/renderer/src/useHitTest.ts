import { useEffect } from 'react'

/**
 * La finestra ignora il mouse ma riceve i movimenti inoltrati da Windows.
 * Se il cursore è sopra un elemento visibile marcato `data-hit`, chiediamo al
 * main di rendere la finestra cliccabile; altrimenti i clic passano sotto.
 */
export function useHitTest(): void {
  useEffect(() => {
    let last: boolean | null = null
    const send = (value: boolean) => {
      if (value === last) return
      last = value
      window.dock.setInteractive(value)
    }
    const onMove = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null
      send(Boolean(el?.closest('[data-hit]')))
    }
    const onLeave = () => send(false)
    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [])
}

/** `true` se l'utente sta scrivendo in un campo: il pannello non deve chiudersi. */
export function isTyping(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(el.type))
}
