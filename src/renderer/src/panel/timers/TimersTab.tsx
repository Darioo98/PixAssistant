import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toISODate } from '@shared/dates'
import {
  REMINDER_REPEATS,
  formatDuration,
  parseLocal,
  remainingOf,
  type ReminderItem,
  type ReminderRepeat,
  type TimerView
} from '@shared/productivity'
import { useData, useNow } from '../../hooks'
import { DeleteButton, RowMenu } from '../RowMenu'
import '../notes/productivity.css'
import { useShiftRemaining } from '../extras/Shift'
import { formatRemaining } from '@shared/shift'
import { Glyph } from '../Glyph'

export function TimersTab({ cyclesToday = 0 }: { cyclesToday?: number }) {
  const { t } = useTranslation()
  const [segment, setSegment] = useState<'timers' | 'reminders'>('timers')
  return (
    <div className="productivity">
      <div className="segmented" role="tablist">
        {(['timers', 'reminders'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={segment === s} className={segment === s ? 'on' : ''} onClick={() => setSegment(s)}>
            {s === 'timers' ? t('timers.tabTimers') : t('timers.tabReminders')}
          </button>
        ))}
      </div>
      {segment === 'timers' ? <Timers cyclesToday={cyclesToday} /> : <Reminders />}
    </div>
  )
}

// ======================= Timer =======================

function Timers({ cyclesToday }: { cyclesToday: number }) {
  const { t } = useTranslation()
  const timers = useData('timers')
  const [label, setLabel] = useState('')
  const [minutes, setMinutes] = useState(10)
  const running = Boolean(timers?.some((x) => x.state === 'running'))
  const now = useNow(running)
  if (!timers) return null

  return (
    <>
      <div className="timer-start">
        <button className="btn primary" onClick={() => void window.pix.data.apply('timers', { op: 'startPomodoro' })}>
          <Glyph name="stopwatch" /> {t('timers.startPomodoro')}
        </button>
        <span className="hint focus-hint">
          {cyclesToday > 0 ? t('timers.cyclesToday', { count: cyclesToday }) : t('timers.focusHint')}
        </span>
      </div>
      <form
        className="todo-add"
        onSubmit={(e) => {
          e.preventDefault()
          void window.pix.data.apply('timers', { op: 'startCustom', label, minutes })
          setLabel('')
        }}
      >
        <span className="label">{t('timers.custom')}</span>
        <div className="inline">
          <input value={label} maxLength={100} placeholder={t('timers.labelPlaceholder')} aria-label={t('timers.label')} onChange={(e) => setLabel(e.target.value)} />
          <input
            type="number"
            className="num"
            min={1}
            max={1440}
            value={minutes}
            aria-label={t('timers.minutes')}
            onChange={(e) => setMinutes(Math.max(1, Math.min(1440, Math.round(Number(e.target.value)) || 1)))}
          />
          <span>{t('timers.minutes')}</span>
          <button className="btn" type="submit">
            {t('timers.start')}
          </button>
        </div>
      </form>

      {timers.length === 0 ? (
        <p className="empty">{t('timers.none')}</p>
      ) : (
        <ul className="timer-list">
          {timers.map((x) => (
            <TimerCard key={x.id} timer={x} now={now} />
          ))}
        </ul>
      )}
    </>
  )
}

function TimerCard({ timer, now }: { timer: TimerView; now: number }) {
  const { t } = useTranslation()
  const remaining = remainingOf(timer, now)
  const progress = timer.durationMs ? 1 - remaining / timer.durationMs : 1
  const apply = (op: 'pause' | 'resume' | 'cancel' | 'next') => void window.pix.data.apply('timers', { op, id: timer.id })
  return (
    <li className={`timer-card ${timer.state} ${timer.phase ?? ''}`}>
      <div className="timer-head">
        <span className="dl-title">{timer.label}</span>
        {timer.kind === 'pomodoro' && <span className="dl-meta">{t('timers.cycles', { count: timer.completedWork })}</span>}
      </div>
      <div className="timer-time">{timer.state === 'waiting' ? t('timers.waiting') : formatDuration(remaining)}</div>
      <div className="timer-track">
        <div className="timer-fill" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
      </div>
      <div className="form-actions">
        {timer.state === 'running' && (
          <button className="btn" onClick={() => apply('pause')}>
            {t('timers.pause')}
          </button>
        )}
        {timer.state === 'paused' && (
          <button className="btn primary" onClick={() => apply('resume')}>
            {t('timers.resume')}
          </button>
        )}
        {timer.kind === 'pomodoro' && (
          <button className={`btn ${timer.state === 'waiting' ? 'primary' : ''}`} onClick={() => apply('next')}>
            {t('timers.startPhase', { phase: '›' })}
          </button>
        )}
        <span className="spacer" />
        <button className="btn subtle" onClick={() => apply('cancel')}>
          {timer.state === 'waiting' ? t('timers.stop') : t('timers.cancel')}
        </button>
      </div>
    </li>
  )
}

/** Tempo rimanente accanto a Pix quando il pannello è chiuso (si aggiorna solo se un timer è in corso). */
export function TimerPill() {
  const { t } = useTranslation()
  const timers = useData('timers')
  const running = (timers ?? []).filter((x) => x.state === 'running')
  const now = useNow(running.length > 0)
  const waiting = (timers ?? []).some((x) => x.state === 'waiting')
  const shiftLeft = useShiftRemaining()
  if (running.length === 0 && !waiting) {
    // Nessun timer: se sei in sede mostra quanto manca alla fine del turno.
    if (shiftLeft === null) return null
    const time = formatRemaining(shiftLeft, { h: t('shift.h'), min: t('shift.min') })
    return (
      <button className="timer-pill" data-hit aria-label={t('shift.pill', { time })} onClick={() => window.pix.openPanel('home')}>
        <Glyph name="work" size={13} /> {time}
      </button>
    )
  }
  const next = running.reduce<TimerView | null>((a, b) => (!a || (b.endsAt ?? 0) < (a.endsAt ?? 0) ? b : a), null)
  const time = next ? formatDuration(remainingOf(next, now)) : null
  return (
    <button className="timer-pill" data-hit aria-label={t('timers.pillLabel', { time })} onClick={() => window.pix.openPanel('timers')}>
      <Glyph name={time === null ? 'pause' : next?.phase === 'work' ? 'stopwatch' : 'clock'} size={13} /> {time}
    </button>
  )
}

// ======================= Promemoria =======================

function defaultAt(): { date: string; time: string } {
  const d = new Date(Date.now() + 60 * 60_000)
  d.setMinutes(0)
  return { date: toISODate(d), time: `${String(d.getHours()).padStart(2, '0')}:00` }
}

function Reminders() {
  const { t, i18n } = useTranslation()
  const reminders = useData('reminders')
  const init = defaultAt()
  const [text, setText] = useState('')
  const [date, setDate] = useState(init.date)
  const [time, setTime] = useState(init.time)
  const [repeat, setRepeat] = useState<ReminderRepeat>('none')
  if (!reminders) return null

  const fmt = (r: ReminderItem) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(parseLocal(r.at))

  return (
    <>
      <form
        className="todo-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim() || !date || !time) return
          void window.pix.data.apply('reminders', { op: 'save', text: text.trim(), at: `${date}T${time}`, repeat })
          setText('')
        }}
      >
        <input value={text} maxLength={500} placeholder={t('reminders.textPlaceholder')} aria-label={t('reminders.text')} onChange={(e) => setText(e.target.value)} />
        <div className="inline">
          <input type="date" value={date} aria-label={t('reminders.date')} onChange={(e) => setDate(e.target.value)} />
          <input type="time" value={time} aria-label={t('reminders.time')} onChange={(e) => setTime(e.target.value)} />
          <select value={repeat} aria-label={t('reminders.repeat')} onChange={(e) => setRepeat(e.target.value as ReminderRepeat)}>
            {REMINDER_REPEATS.map((r) => (
              <option key={r} value={r}>
                {t(`reminders.repeats.${r}`)}
              </option>
            ))}
          </select>
          <button className="btn primary" type="submit" disabled={!text.trim()}>
            {t('reminders.add')}
          </button>
        </div>
      </form>
      {reminders.length === 0 ? (
        <p className="empty">{t('reminders.empty')}</p>
      ) : (
        <ul className="todo-list">
          {reminders.map((r) => (
            <li key={r.id} className={`todo-row ${r.done ? 'done' : ''}`}>
              <span className="todo-text">
                {r.text}
                <em>
                  {' '}
                  · {r.done ? t('reminders.done') : fmt(r)}
                  {r.repeat !== 'none' && ` · ${t(`reminders.repeats.${r.repeat}`)}`}
                  {r.snoozedUntil && !r.done
                    ? ` · ${t('reminders.snoozedUntil', { time: new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(r.snoozedUntil) })}`
                    : ''}
                </em>
              </span>
              <RowMenu label={t('todos.more')}>
                <DeleteButton onConfirm={() => void window.pix.data.apply('reminders', { op: 'remove', id: r.id })} />
              </RowMenu>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
