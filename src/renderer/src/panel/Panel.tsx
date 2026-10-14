import { useTranslation } from 'react-i18next'
import { TABS, type TabId, type UiState } from '@shared/ipc'
import { CloseIcon, TabIcon } from './icons'
import { SettingsTab } from './SettingsTab'
import { HomeTab } from './HomeTab'
import { DeadlinesTab } from './deadlines/DeadlinesTab'
import { VaultTab } from './vault/VaultTab'

/** Milestone in cui arriva ciascuna sezione. */
const MILESTONE: Partial<Record<TabId, number>> = {
  chat: 5,
  notes: 6,
  timers: 6,
  clipboard: 7,
  links: 7
}

export function Panel({ state }: { state: UiState }) {
  const { t } = useTranslation()
  const { tab } = state

  return (
    <section className="panel" data-hit aria-label={t(`tabs.${tab}`)}>
      <nav className="rail" aria-label="Dock">
        {TABS.map((id) => (
          <button
            key={id}
            className={`rail-btn ${id === tab ? 'active' : ''} ${id === 'settings' ? 'bottom' : ''}`}
            title={t(`tabs.${id}`)}
            aria-label={t(`tabs.${id}`)}
            aria-current={id === tab ? 'page' : undefined}
            onClick={() => window.dock.openPanel(id)}
          >
            <TabIcon tab={id} />
          </button>
        ))}
      </nav>
      <div className="panel-body">
        <header className="panel-header">
          <h1>{t(`tabs.${tab}`)}</h1>
          <button className="icon-btn" aria-label={t('panel.close')} title={t('panel.close')} onClick={() => window.dock.closePanel()}>
            <CloseIcon />
          </button>
        </header>
        <div className="panel-content">
          {tab === 'home' && <HomeTab state={state} />}
          {tab === 'deadlines' && <DeadlinesTab defaultLead={state.settings.defaultLeadDays} />}
          {tab === 'vault' && <VaultTab state={state} />}
          {tab === 'settings' && <SettingsTab state={state} />}
          {MILESTONE[tab] && (
            <div className="placeholder">
              <h2>{t('placeholder.title')}</h2>
              <p>{t('placeholder.body', { n: MILESTONE[tab] })}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
