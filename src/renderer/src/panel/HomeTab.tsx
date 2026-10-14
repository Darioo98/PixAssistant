import { useTranslation } from 'react-i18next'
import { compareByUrgency, deadlineStatus } from '@shared/deadlines'
import { useDeadlines, useToday } from '../hooks'
import { DeadlineRow } from './deadlines/DeadlineRow'
import './deadlines/deadlines.css'

/** Riepilogo: scadute e in scadenza nei prossimi 7 giorni (password, to-do e promemoria arriveranno qui). */
export function HomeTab({ defaultLead }: { defaultLead: number }) {
  const { t } = useTranslation()
  const items = useDeadlines()
  const today = useToday()
  if (!items) return null

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
