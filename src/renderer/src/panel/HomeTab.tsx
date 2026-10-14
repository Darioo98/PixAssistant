import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const defaultLead = state.settings.defaultLeadDays
  const items = useDeadlines()
  const passwords = useVaultEntries()
  const today = useToday()
  if (!items) return null
  const toChange = (passwords ?? []).filter((p) => {
    const c = countdown(p, today, defaultLead)
    return c.daysLeft !== null && c.daysLeft <= defaultLead
  })

  const sorted = [...items].sort(compareByUrgency(today, defaultLead))
  const overdue = sorted.filter((i) => deadlineStatus(i, today, defaultLead) === 'overdue')
  const week = sorted.filter((i) => ['today', 'soon', 'week'].includes(deadlineStatus(i, today, defaultLead)))
  const open = () => window.dock.openPanel('deadlines')

  return (
    <div className="home">
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
              <VaultRowLocked key={p.id} entry={p} today={today} lead={defaultLead} onClick={() => window.dock.openPanel('vault')} />
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
