import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { quickAsk } from './chat/useChat'
import { WeatherWidget } from './extras/Weather'
import { ShiftCard } from './extras/Shift'
import { useData } from '../hooks'
import { TodoRow } from './notes/NotesTab'
import { isTodoForToday, parseLocal } from '@shared/productivity'
import './notes/productivity.css'
import { compareByUrgency, deadlineStatus } from '@shared/deadlines'
import type { UiState } from '@shared/ipc'
import { countdown } from '@shared/vault'
import { useDeadlines, useToday, useVaultEntries } from '../hooks'
import { VaultRowLocked } from './vault/VaultList'
import './vault/vault.css'
import { DeadlineRow } from './deadlines/DeadlineRow'
import './deadlines/deadlines.css'

/** Riepilogo: scadute e in scadenza nei prossimi 7 giorni (password, to-do e promemoria arriveranno qui). */
export function HomeTab({ state }: { state: UiState }) {
  const { t, i18n } = useTranslation()
  const defaultLead = state.settings.defaultLeadDays
  const items = useDeadlines()
  const passwords = useVaultEntries()
  const todos = useData('todos')
  const reminders = useData('reminders')
  const today = useToday()
  if (!items) return null
  const todayTodos = (todos ?? []).filter((x) => isTodoForToday(x, today))
  const todayReminders = (reminders ?? []).filter((r) => !r.done && r.at.startsWith(today))
  const toChange = (passwords ?? []).filter((p) => {
    const c = countdown(p, today, defaultLead)
    return c.daysLeft !== null && c.daysLeft <= defaultLead
  })

  const sorted = [...items].sort(compareByUrgency(today, defaultLead))
  const overdue = sorted.filter((i) => deadlineStatus(i, today, defaultLead) === 'overdue')
  const week = sorted.filter((i) => ['today', 'soon', 'week'].includes(deadlineStatus(i, today, defaultLead)))
  const open = () => window.pix.openPanel('deadlines')

  return (
    <div className="home">
      <WeatherWidget city={state.settings.weatherCity} />
      <ShiftCard defaultBreak={state.settings.shiftBreakMinutes} />
      <QuickAsk />
      <QuickNote />
      <section className="home-card">
        <h2 className="home-title">{t('home.todayTitle')}</h2>
        {todayTodos.length === 0 && todayReminders.length === 0 ? (
          <p className="hint">{t('home.nothingToday')}</p>
        ) : (
          <ul className="todo-list">
            {todayReminders.map((r) => (
              <li key={r.id} className="todo-row home-link" onClick={() => window.pix.openPanel('timers')}>
                <span aria-hidden="true">⏰</span>
                <span className="todo-text">
                  {r.text}
                  <em> · {new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(parseLocal(r.at))}</em>
                </span>
              </li>
            ))}
            {todayTodos.map((x) => (
              <TodoRow key={x.id} todo={x} today={today} lang={i18n.language} compact />
            ))}
          </ul>
        )}
      </section>
      {overdue.length > 0 && (
        <section className="home-card">
          <h2 className="home-title st-overdue">
            {t('home.overdueTitle')} <span className="count">{overdue.length}</span>
          </h2>
          <ul className="dl-list">
            {overdue.map((item) => (
              <DeadlineRow key={item.id} item={item} today={today} defaultLead={defaultLead} onEdit={open} compact />
            ))}
          </ul>
        </section>
      )}
      {toChange.length > 0 && (
        <section className="home-card">
          <h2 className="home-title">
            {t('home.passwordsTitle')} <span className="count">{toChange.length}</span>
          </h2>
          <ul className="vault-list">
            {toChange.map((p) => (
              <VaultRowLocked key={p.id} entry={p} today={today} lead={defaultLead} onClick={() => window.pix.openPanel('vault')} />
            ))}
          </ul>
        </section>
      )}
      <section className="home-card">
        <h2 className="home-title">
          {t('home.weekTitle')} {week.length > 0 && <span className="count">{week.length}</span>}
        </h2>
        {week.length === 0 ? (
          <p className="hint">{t('home.nothing')}</p>
        ) : (
          <ul className="dl-list">
            {week.map((item) => (
              <DeadlineRow key={item.id} item={item} today={today} defaultLead={defaultLead} onEdit={open} compact />
            ))}
          </ul>
        )}
        <button className="btn subtle" onClick={open}>
          {t('home.seeAll')}
        </button>
      </section>
    </div>
  )
}

/** Domanda veloce all'AI: apre una nuova conversazione nella Chat. */
function QuickAsk() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="quick-ask"
      onSubmit={(e) => {
        e.preventDefault()
        const q = text.trim()
        if (!q || busy) return
        setBusy(true)
        void quickAsk(q).finally(() => {
          setBusy(false)
          setText('')
        })
      }}
    >
      <input value={text} placeholder={t('home.quickAsk')} aria-label={t('home.quickAsk')} onChange={(e) => setText(e.target.value)} />
      <button className="btn primary" type="submit" disabled={!text.trim() || busy}>
        {t('home.quickAskSend')}
      </button>
    </form>
  )
}

/** Nota veloce: crea una nota con il testo scritto. */
function QuickNote() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  return (
    <form
      className="quick-ask"
      onSubmit={(e) => {
        e.preventDefault()
        const body = text.trim()
        if (!body) return
        void window.pix.data.apply('notes', { op: 'save', note: { title: '', body, pinned: false } }).then(() => {
          setText('')
          setSaved(true)
          window.setTimeout(() => setSaved(false), 1500)
        })
      }}
    >
      <input value={text} placeholder={t('notes.quickNote')} aria-label={t('notes.quickNote')} onChange={(e) => setText(e.target.value)} />
      <button className="btn" type="submit" disabled={!text.trim()}>
        {saved ? t('notes.saved') : t('notes.quickNoteSave')}
      </button>
    </form>
  )
}
