import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatHHMM, formatRemaining, shiftProgress, type ShiftState } from '@shared/shift'
import './extras.css'

export function useShift(): ShiftState | null {
  const [state, setState] = useState<ShiftState | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.dock.shift.onChange((s) => alive && setState(s))
    void window.dock.shift.state().then((s) => alive && s && setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

/** Aggiornamento ogni 30 s: per un conto alla rovescia in minuti basta e avanza. */
function useMinuteClock(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

/** Scheda "Turno in sede" per la Home. */
export function ShiftCard({ defaultBreak }: { defaultBreak: number }) {
  const { t } = useTranslation()
  const state = useShift()
  const [editing, setEditing] = useState(false)
  const [arrival, setArrival] = useState('')
  const [brk, setBrk] = useState(defaultBreak)
  const now = useMinuteClock(Boolean(state?.shift))

  useEffect(() => {
    if (!state) return
    setArrival(state.shift?.arrival ?? state.suggestedArrival)
    setBrk(state.shift?.breakMinutes ?? defaultBreak)
  }, [state, defaultBreak])

  if (!state) return null
  const labels = { h: t('shift.h'), min: t('shift.min') }

  if (!state.shift || editing) {
    return (
      <section className="home-card shift-card">
        <h2 className="home-title">🏢 {t('shift.title')}</h2>
        <form
          className="shift-form"
          onSubmit={(e) => {
            e.preventDefault()
            void window.dock.shift
              .apply(state.shift ? { op: 'adjust', arrival, breakMinutes: brk } : { op: 'start', arrival, breakMinutes: brk })
              .then(() => setEditing(false))
          }}
        >
          <label className="inline">
            <span>{t('shift.arrivedAt')}</span>
            <input type="time" value={arrival} required onChange={(e) => setArrival(e.target.value)} />
          </label>
          <label className="inline">
            <span>{t('shift.breakToday')}</span>
            <input
              type="number"
              className="num"
              min={0}
              max={240}
              value={brk}
              onChange={(e) => setBrk(Math.max(0, Math.min(240, Math.round(Number(e.target.value)) || 0)))}
            />
          </label>
          <div className="form-actions">
            {state.shift && (
              <button type="button" className="btn subtle" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </button>
            )}
            <span className="spacer" />
            <button type="submit" className="btn primary" disabled={!arrival}>
              {state.shift ? t('shift.save') : t('shift.start')}
            </button>
          </div>
        </form>
      </section>
    )
  }

  const s = state.shift
  const end = state.endsAt ?? 0
  const remaining = end - now
  const work = formatRemaining(s.workMinutes * 60_000, labels)
  return (
    <section className="home-card shift-card">
      <h2 className="home-title">🏢 {t('shift.title')}</h2>
      <div className="shift-main">
        <strong>{t('shift.endsAt', { time: formatHHMM(new Date(end).getHours() * 60 + new Date(end).getMinutes()) })}</strong>
        <span className={remaining > 0 ? 'shift-left' : 'shift-over'}>
          {remaining > 0
            ? t('shift.left', { time: formatRemaining(remaining, labels) })
            : t('shift.over', { time: formatRemaining(-remaining, labels) })}
        </span>
      </div>
      <div className="timer-track">
        <div className="timer-fill" style={{ width: `${shiftProgress(s, now) * 100}%` }} />
      </div>
      <div className="form-actions">
        <span className="dl-meta">
          {t('shift.arrival', { time: s.arrival })} · {t('shift.workBreak', { work, brk: s.breakMinutes })}
        </span>
        <span className="spacer" />
        <button className="btn subtle" onClick={() => setEditing(true)}>
          {t('shift.edit')}
        </button>
        <button className="btn subtle" onClick={() => void window.dock.shift.apply({ op: 'clear' })}>
          {t('shift.clear')}
        </button>
      </div>
    </section>
  )
}

/** Tempo che manca alla fine del turno, per l'etichetta accanto a Pix. */
export function useShiftRemaining(): number | null {
  const state = useShift()
  const now = useMinuteClock(Boolean(state?.endsAt))
  if (!state?.endsAt) return null
  const left = state.endsAt - now
  return left > 0 ? left : null
}
