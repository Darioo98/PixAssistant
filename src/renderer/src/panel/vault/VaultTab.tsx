import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UiState } from '@shared/ipc'
import { groupPath, type VaultEntryView } from '@shared/vault'
import { useToday, useVaultData } from '../../hooks'
import { HelloBanner, LinkPc, RecoveryKeyStep, SetupIntro, UnlockPanel } from './VaultAccess'
import { VaultRow, VaultRowLocked } from './VaultList'
import { NewPasswordDialog, VaultForm } from './VaultForm'
import { FolderTree } from './VaultGroups'
import './vault.css'

type View =
  | { kind: 'list' }
  | { kind: 'edit'; entry?: VaultEntryView; groupId?: string | null }
  | { kind: 'newPassword'; entry: VaultEntryView }

export function VaultTab({ state }: { state: UiState }) {
  const { t, i18n } = useTranslation()
  const status = state.vault
  const data = useVaultData()
  const today = useToday()
  const lead = state.settings.defaultLeadDays
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>({ kind: 'list' })
  /** Nuova cartella al primo livello in corso di creazione. */
  const [newRoot, setNewRoot] = useState(false)

  const entries = data?.entries ?? null
  const groups = data?.groups ?? []

  // "Genera" da un avviso di Pix: appena la cassaforte è aperta si apre il generatore sulla voce.
  useEffect(() => {
    const intent = state.intent
    if (intent?.kind !== 'vault-generate' || !status.unlocked || !entries) return
    const entry = entries.find((e) => e.id === intent.id)
    if (entry) setView({ kind: 'newPassword', entry })
    window.pix.clearIntent()
  }, [state.intent, status.unlocked, entries])

  // Se la cassaforte si chiude mentre si sta modificando, si torna all'elenco.
  useEffect(() => {
    if (!status.unlocked) setView({ kind: 'list' })
  }, [status.unlocked])

  // La ricerca guarda in tutte le cartelle e mostra il percorso di ogni voce.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!entries || !q) return null
    return entries.filter((e) => [e.name, e.username ?? '', e.url ?? '', ...groupPath(e.groupId, groups)].some((f) => f.toLowerCase().includes(q)))
  }, [entries, groups, query])

  if (status.recoveryPending) return <RecoveryKeyStep />
  if (status.setup === 'unconfigured') return <SetupIntro />
  if (status.setup === 'needsRecovery') return <LinkPc />
  if (!entries) return null

  const pathOf = (e: VaultEntryView) => groupPath(e.groupId, groups).join(' › ')

  if (!status.unlocked) {
    return (
      <div className="vault">
        <UnlockPanel status={status} />
        {entries.length > 0 && (
          <FolderTree
            entries={entries}
            groups={groups}
            editable={false}
            renderEntry={(e, depth) => <VaultRowLocked key={e.id} entry={e} today={today} lead={lead} depth={depth} />}
          />
        )}
      </div>
    )
  }

  const close = () => setView({ kind: 'list' })
  if (view.kind === 'edit') {
    return <VaultForm entry={view.entry} settings={state.settings} groups={groups} defaultGroup={view.groupId ?? null} onClose={close} />
  }
  if (view.kind === 'newPassword') return <NewPasswordDialog entry={view.entry} settings={state.settings} onClose={close} />

  const until = status.unlockedUntil
    ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(status.unlockedUntil)
    : ''

  const row = (e: VaultEntryView, depth: number, path?: string) => (
    <VaultRow
      key={e.id}
      entry={e}
      groups={groups}
      depth={depth}
      path={path}
      today={today}
      lead={lead}
      onEdit={(entry) => setView({ kind: 'edit', entry })}
      onNewPassword={(entry) => setView({ kind: 'newPassword', entry })}
    />
  )

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
        <button className="btn" title={t('vault.groups.new')} onClick={() => setNewRoot(true)}>
          + {t('vault.groups.folder')}
        </button>
        <button className="btn primary" onClick={() => setView({ kind: 'edit' })}>
          + {t('vault.new')}
        </button>
      </div>
      <div className="vault-session">
        <span className="hint">{t('vault.session', { time: until })}</span>
        <button className="btn subtle" onClick={() => void window.pix.vault.apply({ op: 'lock' })}>
          {t('vault.lock')}
        </button>
      </div>
      {results ? (
        results.length === 0 ? (
          <p className="empty">{t('vault.noResults')}</p>
        ) : (
          <ul className="vault-list">{results.map((e) => row(e, 0, pathOf(e)))}</ul>
        )
      ) : entries.length === 0 && groups.length === 0 && !newRoot ? (
        <p className="empty">{t('vault.empty')}</p>
      ) : (
        <>
          <FolderTree
            entries={entries}
            groups={groups}
            editable
            creatingIn={newRoot ? null : undefined}
            onCreated={() => setNewRoot(false)}
            onNewEntry={(groupId) => setView({ kind: 'edit', groupId })}
            renderEntry={(e, depth) => row(e, depth)}
          />
          {groups.length > 0 && <p className="hint">{t('vault.groups.dragHint')}</p>}
        </>
      )}
    </div>
  )
}
