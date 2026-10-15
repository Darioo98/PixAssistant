import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VaultEntryView } from '@shared/vault'
import type { HealthIssue, VaultHealth } from '@shared/vaultHealth'

interface Props {
  entries: VaultEntryView[]
  onEdit: (entry: VaultEntryView) => void
  onNewPassword: (entry: VaultEntryView) => void
}

/** Riepilogo della salute delle password; l'analisi avviene nel processo principale. */
export function VaultHealthCard({ entries, onEdit, onNewPassword }: Props) {
  const { t } = useTranslation()
  const [health, setHealth] = useState<VaultHealth | null>(null)
  const [open, setOpen] = useState(false)

  // Si ricalcola quando cambiano le voci (nuova password, modifica, sincronizzazione).
  const signature = entries.map((e) => `${e.id}:${e.lastChanged}:${e.historyCount ?? 0}`).join('|')
  useEffect(() => {
    let alive = true
    void window.pix.vault.apply({ op: 'health' }).then((r) => alive && r.ok && r.health && setHealth(r.health))
    return () => {
      alive = false
    }
  }, [signature])

  if (!health || health.checked === 0) return null
  const weak = health.issues.filter((i) => i.weak).length
  const reused = health.issues.filter((i) => i.reusedWith > 0).length
  const old = health.issues.filter((i) => i.oldDays !== null).length
  const byId = new Map(entries.map((e) => [e.id, e]))
  const level = health.score >= 90 ? 'good' : health.score >= 60 ? 'fair' : 'poor'

  return (
    <section className={`health health-${level}`}>
      <button className="health-summary" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={health.issues.length === 0}>
        <span className="health-score" aria-hidden="true">
          {health.score}
        </span>
        <span className="health-text">
          <strong>{t('vault.health.title')}</strong>
          <span className="hint">
            {health.issues.length === 0
              ? t('vault.health.allGood', { count: health.checked })
              : [weak && t('vault.health.weakCount', { count: weak }), reused && t('vault.health.reusedCount', { count: reused }), old && t('vault.health.oldCount', { count: old })]
                  .filter(Boolean)
                  .join(' · ')}
          </span>
        </span>
        {health.issues.length > 0 && <span className="health-chevron">{open ? '▴' : '▾'}</span>}
      </button>
      {open && (
        <ul className="health-list">
          {health.issues.map((issue) => {
            const entry = byId.get(issue.id)
            if (!entry) return null
            return (
              <li key={issue.id}>
                <button className="health-name" onClick={() => onEdit(entry)}>
                  {entry.name}
                </button>
                <span className="health-tags">{reasons(issue, t)}</span>
                <button className="btn subtle" onClick={() => onNewPassword(entry)}>
                  {t('vault.health.fix')}
                </button>
              </li>
            )
          })}
          <li className="hint">{t('vault.health.privacy')}</li>
        </ul>
      )}
    </section>
  )
}

function reasons(issue: HealthIssue, t: (k: string, o?: Record<string, unknown>) => string): string {
  const out: string[] = []
  if (issue.weak) out.push(t(`vault.health.weak.${issue.weak}`))
  if (issue.reusedWith > 0) out.push(t('vault.health.reused', { count: issue.reusedWith }))
  if (issue.oldDays !== null) out.push(t('vault.health.old', { count: Math.floor(issue.oldDays / 30) }))
  return out.join(' · ')
}
