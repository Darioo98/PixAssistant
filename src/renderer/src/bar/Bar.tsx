import { useEffect, useRef, useState } from 'react'
import { Pix } from './Pix'
import type { Settings } from '@shared/settings'

const HOVER_DELAY_MS = 150
const LEAVE_DELAY_MS = 1500
const BREATH_EVERY_MS = 25_000

/**
 * Barra sottile sul bordo destro. Al passaggio del mouse (con un piccolo
 * ritardo) lascia il posto a Pix; il clic su Pix apre il pannello.
 * La trasformazione fluida barra → Pix arriva nella milestone 2: qui c'è una dissolvenza.
 */
export function Bar({ panelOpen, animations }: { panelOpen: boolean; animations: Settings['animations'] }) {
  const [expanded, setExpanded] = useState(false)
  const [breathing, setBreathing] = useState(false)
  const enterTimer = useRef<number | undefined>(undefined)
  const leaveTimer = useRef<number | undefined>(undefined)

  const showPix = panelOpen || expanded

  // Respiro "a intervalli": un ciclo ogni 25 s, poi nessuna animazione attiva
  // (così da ferma la finestra non consuma CPU/GPU).
  useEffect(() => {
    if (showPix || animations === 'off') return
    const id = window.setInterval(() => setBreathing(true), BREATH_EVERY_MS)
    return () => window.clearInterval(id)
  }, [showPix, animations])

  useEffect(() => () => {
    window.clearTimeout(enterTimer.current)
    window.clearTimeout(leaveTimer.current)
  }, [])

  const onEnter = () => {
    window.clearTimeout(leaveTimer.current)
    if (!expanded) enterTimer.current = window.setTimeout(() => setExpanded(true), HOVER_DELAY_MS)
  }
  const onLeave = () => {
    window.clearTimeout(enterTimer.current)
    leaveTimer.current = window.setTimeout(() => setExpanded(false), LEAVE_DELAY_MS)
  }

  return (
    <>
      <div
        className={`bar-hit ${showPix ? 'hidden' : ''}`}
        data-hit={showPix ? undefined : true}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <div className={`bar ${breathing ? 'breathe' : ''}`} onAnimationEnd={() => setBreathing(false)} />
      </div>
      <div className={`pix-slot ${showPix ? 'visible' : ''}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        {showPix && <Pix onClick={() => (panelOpen ? window.dock.closePanel() : window.dock.openPanel())} />}
      </div>
    </>
  )
}
