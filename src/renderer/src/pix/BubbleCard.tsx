import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Bubble } from '@shared/mascot'
import { CloseIcon } from '../panel/icons'

/**
 * Fumetto in stile notifica moderna. Si chiude da solo dopo il tempo impostato;
 * il conto si ferma mentre il mouse è sopra.
 */
export function BubbleCard({ bubble, panelOpen }: { bubble: Bubble; panelOpen: boolean }) {
  const { t, i18n } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const remaining = useRef(bubble.timeoutMs)
  const sent = useRef(false)

  const finish = (outcome: Parameters<typeof window.dock.bubbleOutcome>[1]) => {
    if (sent.current) return
    sent.current = true
    window.dock.bubbleOutcome(bubble.id, outcome)
  }

  useEffect(() => {
    if (hovered) return
    const started = performance.now()
    const id = window.setTimeout(() => finish({ kind: 'timeout' }), remaining.current)
    return () => {
      window.clearTimeout(id)
      remaining.current = Math.max(1500, remaining.current - (performance.now() - started))
    }
  }, [hovered, bubble.id])

  const age = Date.now() - bubble.time
  const when =
    age < 60_000
      ? t('bubble.now')
      : new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(bubble.time)

  return (
    <div
      className={`bubble ${panelOpen ? 'above' : ''}`}
      data-hit
      data-pix-zone
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="bubble-head">
        <span>
          {bubble.category} · {when}
        </span>
        <button className="icon-btn small" aria-label={t('bubble.close')} onClick={() => finish({ kind: 'dismiss' })}>
          <CloseIcon />
        </button>
      </div>
      <p className="bubble-text">{bubble.text}</p>
      {bubble.actions.length > 0 && (
        <div className="bubble-actions">
          {bubble.actions.map((a) => (
            <button
              key={a.id}
              className={`pill ${a.primary ? 'primary' : ''}`}
              onClick={() => finish({ kind: 'action', actionId: a.id })}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
