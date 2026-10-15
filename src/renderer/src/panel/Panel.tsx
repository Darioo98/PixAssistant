import { useTranslation } from 'react-i18next'
import { TABS, type UiState } from '@shared/ipc'
import { CloseIcon, TabIcon } from './icons'
import { SettingsTab } from './SettingsTab'
import { HomeTab } from './HomeTab'
import { DeadlinesTab } from './deadlines/DeadlinesTab'
import { VaultTab } from './vault/VaultTab'
import { ChatTab } from './chat/ChatTab'
import { NotesTab } from './notes/NotesTab'
import { TimersTab } from './timers/TimersTab'
import { ClipboardTab } from './extras/ClipboardTab'
import { LinksTab } from './extras/LinksTab'

export function Panel({ state }: { state: UiState }) {
  const { t } = useTranslation()
  const { tab } = state

  return (
    <section className="panel" data-hit aria-label={t(`tabs.${tab}`)}>
      <nav className="rail" aria-label="Pix">
        {TABS.map((id) => (
          <button
            key={id}
            className={`rail-btn ${id === tab ? 'active' : ''} ${id === 'settings' ? 'bottom' : ''}`}
            title={t(`tabs.${id}`)}
            aria-label={t(`tabs.${id}`)}
            aria-current={id === tab ? 'page' : undefined}
            onClick={() => window.pix.openPanel(id)}
          >
            <TabIcon tab={id} />
          </button>
        ))}
      </nav>
      <div className="panel-body">
        <header className="panel-header">
          <h1>{t(`tabs.${tab}`)}</h1>
          <button className="icon-btn" aria-label={t('panel.close')} title={t('panel.close')} onClick={() => window.pix.closePanel()}>
            <CloseIcon />
          </button>
        </header>
        <div key={tab} className={`panel-content tab-${tab}`}>
          {tab === 'home' && <HomeTab state={state} />}
          {tab === 'deadlines' && <DeadlinesTab defaultLead={state.settings.defaultLeadDays} />}
          {tab === 'vault' && <VaultTab state={state} />}
          {tab === 'chat' && <ChatTab />}
          {tab === 'notes' && <NotesTab />}
          {tab === 'timers' && <TimersTab />}
          {tab === 'clipboard' && <ClipboardTab />}
          {tab === 'links' && <LinksTab />}
          {tab === 'settings' && <SettingsTab state={state} />}
        </div>
      </div>
    </section>
  )
}
