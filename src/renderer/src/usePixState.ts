import { useEffect, useState } from 'react'
import i18next from './i18n'
import type { UiState } from '@shared/ipc'

/** Stato dell'interfaccia, sempre allineato a quello del processo main. */
export function usePixState(): UiState | null {
  const [state, setState] = useState<UiState | null>(null)

  useEffect(() => {
    let alive = true
    const apply = (s: UiState) => {
      if (!alive) return
      if (i18next.language !== s.lang) void i18next.changeLanguage(s.lang)
      document.documentElement.lang = s.lang
      document.documentElement.dataset.animations = s.settings.animations
      setState(s)
    }
    const off = window.pix.onState(apply)
    void window.pix.getState().then(apply)
    return () => {
      alive = false
      off()
    }
  }, [])

  return state
}
