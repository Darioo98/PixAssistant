import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UiState } from '@shared/ipc'
import type { VaultEntryView } from '@shared/vault'
import { useToday, useVaultEntries } from '../../hooks'
import { HelloBanner, LinkPc, RecoveryKeyStep, SetupIntro, UnlockPanel } from './VaultAccess'
import { VaultRow, VaultRowLocked } from './VaultList'
import { NewPasswordDialog, VaultForm } from './VaultForm'
import './vault.css'

type View = { kind: 'list' } | { kind: 'edit'; entry?: VaultEntryView } | { kind: 'newPassword'; entry: VaultEntryView }

export function VaultTab({ state }: { state: UiState }) {
  const { t, i18n } = useTranslation()
  const status = state.vault
  const entries = useVaultEntries()
  const today = useToday()
  const lead = state.settings.defaultLeadDays
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>({ kind: 'list' })

  // "Genera" da un avviso di Pix: appena la cassaforte è aperta si apre il generatore sulla voce.
  useEffect(() => {
    const intent = state.intent
    if (intent?.kind !== 'vault-generate' || !status.unlocked || !entries) return
    const entry = entries.find((e) => e.id === intent.id)
    if (entry) setView({ kind: 'newPassword', entry })
    window.dock.clearIntent()
  }, [state.intent, status.unlocked, entries])

  // Se la cassaforte si chiude mentre si sta modificando, si torna all'elenco.
  useEffect(() => {
    if (!status.unlocked) setView({ kind: 'list' })
  }, [status.unlocked])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!entries) return []
    return q
      ? entries.filter((e) => [e.name, e.username ?? '', e.url ?? ''].some((f) => f.toLowerCase().includes(q)))
      : entries
  }, [entries, query])

  if (status.recoveryPending) return <RecoveryKeyStep />
  if (status.setup === 'unconfigured') return <SetupIntro />
  if (status.setup === 'needsRecovery') return <LinkPc />
  if (!entries) return null

  if (!status.unlocked) {
    return (
      <div className="vault">
        <UnlockPanel status={status} />
        {entries.length > 0 && (
          <ul className="vault-list">
            {entries.map((e) => (
              <VaultRowLocked key={e.id} entry={e} today={today} lead={lead} />
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (view.kind === 'edit') return <VaultForm entry={view.entry} settings={state.settings} onClose={() => setView({ kind: 'list' })} />
  if (view.kind === 'newPassword')
    return <NewPasswordDialog entry={view.entry} settings={state.settings} onClose={() => setView({ kind: 'list' })} />

  const until = status.unlockedUntil
    ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(status.unlockedUntil)
    : ''

  return (
    <div className="vault">
      {status.helloAvailable && !status.helloEnrolled && <HelloBanner />}
      {!status.secureClipboard && <p className="warning">{t('vault.clipboardWarning')}</p>}
      <div className="toolbar">
        <input
          className="search"
          type="search"
          value={query}
          placeholder={t('vault.search')}
          aria-label={t('vault.search')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn primary" onClick={() => setView({ kind: 'edit' })}>
          + {t('vault.new')}
        </button>
      </div>
      <div className="vault-session">
        <span className="hint">{t('vault.session', { time: until })}</span>
        <button className="btn subtle" onClick={() => void window.dock.vault.apply({ op: 'lock' })}>
          {t('vault.lock')}
        </button>
      </div>
      {filtered.length === 0 ? (
        <p className="empty">{entries.length === 0 ? t('vault.empty') : t('vault.noResults')}</p>
      ) : (
        <ul className="vault-list">
          {filtered.map((e) => (
            <VaultRow
              key={e.id}
              entry={e}
              today={today}
              lead={lead}
              onEdit={(entry) => setView({ kind: 'edit', entry })}
              onNewPassword={(entry) => setView({ kind: 'newPassword', entry })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
