import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UiState } from '@shared/ipc'
import type { VaultEntryView, VaultGroupView } from '@shared/vault'
import { useToday, useVaultData } from '../../hooks'
import { HelloBanner, LinkPc, RecoveryKeyStep, SetupIntro, UnlockPanel } from './VaultAccess'
import { VaultRow, VaultRowLocked } from './VaultList'
import { NewPasswordDialog, VaultForm } from './VaultForm'
import { GroupChips, GroupDot, GroupManager, loadCollapsed, loadFilter, saveCollapsed, saveFilter, type GroupFilter } from './VaultGroups'
import './vault.css'

type View = { kind: 'list' } | { kind: 'edit'; entry?: VaultEntryView } | { kind: 'newPassword'; entry: VaultEntryView } | { kind: 'groups' }

interface Section {
  key: string
  group: VaultGroupView | null
  entries: VaultEntryView[]
}

/** Divide le voci per raccolta (nell'ordine delle raccolte, "senza raccolta" in fondo). */
function sectionsOf(entries: VaultEntryView[], groups: VaultGroupView[]): Section[] {
  const sections: Section[] = groups.map((g) => ({ key: g.id, group: g, entries: entries.filter((e) => e.groupId === g.id) }))
  sections.push({ key: 'none', group: null, entries: entries.filter((e) => e.groupId === null) })
  return sections.filter((s) => s.entries.length > 0)
}

export function VaultTab({ state }: { state: UiState }) {
  const { t, i18n } = useTranslation()
  const status = state.vault
  const data = useVaultData()
  const today = useToday()
  const lead = state.settings.defaultLeadDays
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [filter, setFilterState] = useState<GroupFilter>(loadFilter)
  const [collapsed, setCollapsedState] = useState<string[]>(loadCollapsed)

  const entries = data?.entries ?? null
  const groups = data?.groups ?? []

  const setFilter = (f: GroupFilter) => {
    setFilterState(f)
    saveFilter(f)
  }
  const toggleSection = (key: string) => {
    const next = collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]
    setCollapsedState(next)
    saveCollapsed(next)
  }

  // Una raccolta eliminata (anche da un altro PC) non resta selezionata.
  const activeFilter: GroupFilter = filter === 'all' || filter === 'none' || groups.some((g) => g.id === filter) ? filter : 'all'

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
    if (!entries) return []
    const q = query.trim().toLowerCase()
    // La ricerca guarda in tutte le raccolte.
    if (q) return entries.filter((e) => [e.name, e.username ?? '', e.url ?? ''].some((f) => f.toLowerCase().includes(q)))
    if (activeFilter === 'all') return entries
    if (activeFilter === 'none') return entries.filter((e) => e.groupId === null)
    return entries.filter((e) => e.groupId === activeFilter)
  }, [entries, query, activeFilter])

  if (status.recoveryPending) return <RecoveryKeyStep />
  if (status.setup === 'unconfigured') return <SetupIntro />
  if (status.setup === 'needsRecovery') return <LinkPc />
  if (!entries) return null

  /** Elenco: diviso in sezioni per raccolta quando si guardano "Tutte" senza cercare. */
  const renderList = (render: (e: VaultEntryView) => ReactNode) => {
    const grouped = activeFilter === 'all' && !query.trim() && groups.length > 0
    if (!grouped) return <ul className="vault-list">{filtered.map(render)}</ul>
    return sectionsOf(filtered, groups).map((s) => {
      const closed = collapsed.includes(s.key)
      return (
        <section key={s.key} className="vault-section">
          <button className="section-head" aria-expanded={!closed} onClick={() => toggleSection(s.key)}>
            <span aria-hidden="true">{closed ? '▸' : '▾'}</span>
            <GroupDot color={s.group?.color} />
            <span>{s.group?.name ?? t('vault.groups.none')}</span>
            <em>{s.entries.length}</em>
          </button>
          {!closed && <ul className="vault-list">{s.entries.map(render)}</ul>}
        </section>
      )
    })
  }

  if (!status.unlocked) {
    return (
      <div className="vault">
        <UnlockPanel status={status} />
        {entries.length > 0 && (
          <>
            {groups.length > 0 && <GroupChips groups={groups} entries={entries} filter={activeFilter} onFilter={setFilter} />}
            {renderList((e) => (
              <VaultRowLocked key={e.id} entry={e} today={today} lead={lead} />
            ))}
          </>
        )}
      </div>
    )
  }

  const close = () => setView({ kind: 'list' })
  if (view.kind === 'groups') return <GroupManager groups={groups} entries={entries} onClose={close} />
  if (view.kind === 'edit') {
    const defaultGroup = activeFilter !== 'all' && activeFilter !== 'none' ? activeFilter : null
    return <VaultForm entry={view.entry} settings={state.settings} groups={groups} defaultGroup={defaultGroup} onClose={close} />
  }
  if (view.kind === 'newPassword') return <NewPasswordDialog entry={view.entry} settings={state.settings} onClose={close} />

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
      <GroupChips groups={groups} entries={entries} filter={activeFilter} onFilter={setFilter} onManage={() => setView({ kind: 'groups' })} />
      <div className="vault-session">
        <span className="hint">{t('vault.session', { time: until })}</span>
        <button className="btn subtle" onClick={() => void window.dock.vault.apply({ op: 'lock' })}>
          {t('vault.lock')}
        </button>
      </div>
      {filtered.length === 0 ? (
        <p className="empty">{entries.length === 0 ? t('vault.empty') : t('vault.noResults')}</p>
      ) : (
        renderList((e) => (
          <VaultRow
            key={e.id}
            entry={e}
            groups={groups}
            today={today}
            lead={lead}
            onEdit={(entry) => setView({ kind: 'edit', entry })}
            onNewPassword={(entry) => setView({ kind: 'newPassword', entry })}
          />
        ))
      )}
    </div>
  )
}
