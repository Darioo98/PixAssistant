import { useEffect } from 'react'
import { useDockState } from './useDockState'
import { isTyping, useHitTest } from './useHitTest'
import { Mascot } from './pix/Mascot'
import { Panel } from './panel/Panel'
import { TimerPill } from './panel/timers/TimersTab'

const LEAVE_CLOSE_MS = 800

export function App() {
  const state = useDockState()
  useHitTest()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state?.panelOpen) window.dock.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state?.panelOpen])

  // Chiusura allontanando il mouse (facoltativa): mai mentre si sta scrivendo.
  const closeOnLeave = Boolean(state?.panelOpen && state.settings.closeOnMouseLeave)
  useEffect(() => {
    if (!closeOnLeave) return
    let timer: number | undefined
    const arm = () => {
      if (timer !== undefined) return
      timer = window.setTimeout(() => {
        timer = undefined
        if (!isTyping()) window.dock.closePanel()
      }, LEAVE_CLOSE_MS)
    }
    const disarm = () => {
      window.clearTimeout(timer)
      timer = undefined
    }
    const onMove = (e: MouseEvent) => {
      const inside = e.target instanceof Element && e.target.closest('[data-hit]')
      if (inside) disarm()
      else arm()
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', arm)
    return () => {
      disarm()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', arm)
    }
  }, [closeOnLeave])

  if (!state) return null
  return (
    <div className="stage">
      {state.panelOpen && <Panel state={state} />}
      <Mascot mascot={state.mascot} panelOpen={state.panelOpen} settings={state.settings} />
      {!state.panelOpen && <TimerPill />}
    </div>
  )
}
