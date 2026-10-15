import { useEffect, useState } from 'react'
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
import { SearchOverlay } from './search/SearchOverlay'
import { FOCUS_EVENT, SEARCH_EVENT } from './focus'
import { saveSelected } from './chat/useChat'
import { Glyph } from './Glyph'

export function Panel({ state }: { state: UiState }) {
  const { t } = useTranslation()
  const { tab } = state
  /** Ricerca globale aperta (con il testo iniziale) o chiusa. */
  const [searching, setSearching] = useState<string | null>(null)
  /** Cambia a ogni apertura mirata: la sezione si rimonta e legge la richiesta. */
  const [focusSeq, setFocusSeq] = useState(0)

  useEffect(() => {
    const onSearch = (e: Event) => setSearching((e as CustomEvent<string>).detail ?? '')
    const onFocus = () => setFocusSeq((n) => n + 1)
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault()
        setSearching((q) => q ?? '')
      }
    }
    window.addEventListener(SEARCH_EVENT, onSearch)
    window.addEventListener(FOCUS_EVENT, onFocus)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(SEARCH_EVENT, onSearch)
      window.removeEventListener(FOCUS_EVENT, onFocus)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Scorciatoia globale della ricerca: arriva come richiesta dal processo principale.
  useEffect(() => {
    const intent = state.intent
    if (intent?.kind === 'search') {
      setSearching(intent.query ?? '')
      window.pix.clearIntent()
    } else if (intent?.kind === 'chat') {
      // Chat aperta da Pix (es. documento da analizzare): mostra quella conversazione.
      saveSelected(intent.id)
      setFocusSeq((n) => n + 1)
      window.pix.clearIntent()
    }
  }, [state.intent])

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
          <div className="header-actions">
            <button className="icon-btn" aria-label={t('search.title')} title={t('search.button')} onClick={() => setSearching('')}>
              <Glyph name="search" />
            </button>
            <button className="icon-btn" aria-label={t('panel.close')} title={t('panel.close')} onClick={() => window.pix.closePanel()}>
              <CloseIcon />
            </button>
          </div>
        </header>
        {searching !== null && <SearchOverlay key={searching} initial={searching} onClose={() => setSearching(null)} />}
        <div key={`${tab}-${focusSeq}`} className={`panel-content tab-${tab}`}>
          {tab === 'home' && <HomeTab state={state} />}
          {tab === 'deadlines' && <DeadlinesTab defaultLead={state.settings.defaultLeadDays} />}
          {tab === 'vault' && <VaultTab state={state} />}
          {tab === 'chat' && <ChatTab />}
          {tab === 'notes' && <NotesTab />}
          {tab === 'timers' && <TimersTab cyclesToday={state.day.cyclesToday} />}
          {tab === 'clipboard' && <ClipboardTab />}
          {tab === 'links' && <LinksTab />}
          {tab === 'settings' && <SettingsTab state={state} />}
        </div>
      </div>
    </section>
  )
}
