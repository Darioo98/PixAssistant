import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MaintenanceOp, MaintenanceState } from '@shared/maintenance'

function useMaintenance(): MaintenanceState | null {
  const [state, setState] = useState<MaintenanceState | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.dock.maintenance.onChange((s) => alive && setState(s))
    void window.dock.maintenance.state().then((s) => alive && s && setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

const COLLECTION_KEYS: Record<string, string> = {
  settings: 'tabs.settings',
  deadlines: 'tabs.deadlines',
  'vault-meta': 'tabs.vault',
  vault: 'tabs.vault',
  chats: 'tabs.chat',
  notes: 'notes.tabNotes',
  todos: 'notes.tabTodos',
  reminders: 'timers.tabReminders',
  links: 'tabs.links'
}

/** Backup, import, conflitti di sincronizzazione e cartella dati. */
export function MaintenanceSection() {
  const { t, i18n } = useTranslation()
  const state = useMaintenance()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [recovery, setRecovery] = useState('')
  const [busy, setBusy] = useState(false)

  if (!state) return null

  const fmt = (ms: number) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)

  const run = async (op: MaintenanceOp, okText: (v?: string) => string) => {
    setBusy(true)
    setMessage(null)
    const r = await window.dock.maintenance.apply(op)
    setBusy(false)
    if (r.ok) setMessage({ ok: true, text: okText(r.value) })
    else if (r.error !== 'canceled') {
      const key = `maint.errors.${r.error}`
      setMessage({ ok: false, text: i18n.exists(key) ? t(key) : t('maint.errors.generic') })
    }
    return r.ok
  }

  return (
    <div className="maintenance">
      <p className="hint">
        {state.lastBackup ? t('maint.lastBackup', { date: fmt(state.lastBackup) }) : t('maint.noBackup')}
        {state.lastSync ? ` · ${t('maint.lastSync', { date: fmt(state.lastSync) })}` : ''}
      </p>
      {!state.canBackup && <p className="hint">{t('maint.needsVault')}</p>}
      <div className="button-row">
        <button className="btn" disabled={!state.canBackup || busy} onClick={() => void run({ op: 'export' }, (p) => t('maint.exported', { path: p }))}>
          {t('maint.export')}
        </button>
        <button className="btn" disabled={busy} onClick={() => setImportOpen(!importOpen)}>
          {t('maint.import')}
        </button>
        <button className="btn subtle" disabled={!state.canBackup || busy} onClick={() => void run({ op: 'backupNow' }, () => t('maint.backupDone'))}>
          {t('maint.backupNow')}
        </button>
        <button className="btn subtle" onClick={() => void window.dock.maintenance.apply({ op: 'openBackups' })}>
          {t('maint.openBackups')}
        </button>
      </div>

      {importOpen && (
        <form
          className="recovery-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run({ op: 'import', recoveryKey: recovery }, (n) => t('maint.imported', { count: Number(n) })).then((ok) => {
              if (ok) {
                setRecovery('')
                setImportOpen(false)
              }
            })
          }}
        >
          <p className="hint">{t('maint.importHint')}</p>
          <input
            className="mono"
            value={recovery}
            spellCheck={false}
            autoComplete="off"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            aria-label={t('vault.unlock.recoveryLabel')}
            onChange={(e) => setRecovery(e.target.value)}
          />
          <button className="btn primary" type="submit" disabled={busy || recovery.replace(/[\s-]/g, '').length < 32}>
            {t('maint.chooseFile')}
          </button>
        </form>
      )}

      {message && <p className={message.ok ? 'hint' : 'error'}>{message.text}</p>}

      {state.conflicts.length > 0 && (
        <div className="conflicts">
          <h3>{t('maint.conflictsTitle', { count: state.conflicts.length })}</h3>
          <p className="hint">{t('maint.conflictsHint')}</p>
          <ul>
            {state.conflicts.map((c) => (
              <li key={c.id}>
                <span className="conflict-text">
                  <strong>{c.title || '—'}</strong>
                  <span className="dl-meta">
                    {t(COLLECTION_KEYS[c.collection] ?? 'tabs.settings')} · {t('maint.discardedVersion', { date: fmt(c.discardedAt) })}
                  </span>
                </span>
                <button className="btn" onClick={() => void window.dock.maintenance.apply({ op: 'resolveConflict', id: c.id, action: 'restore' })}>
                  {t('maint.restore')}
                </button>
                <button className="btn subtle" onClick={() => void window.dock.maintenance.apply({ op: 'resolveConflict', id: c.id, action: 'dismiss' })}>
                  {t('maint.dismiss')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="button-row">
        <button className="btn subtle" disabled={busy} onClick={() => void run({ op: 'changeDataDir' }, () => t('maint.restarting'))}>
          {t('maint.changeDataDir')}
        </button>
      </div>
      <p className="hint">{t('maint.changeDataDirHint')}</p>
    </div>
  )
}
