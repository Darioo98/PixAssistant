import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ISODate } from '@shared/dates'
import { countdown, type VaultEntryView, type VaultGroupView } from '@shared/vault'
import { DeleteButton, RowMenu } from '../RowMenu'

/** Barra colorata (verde, giallo, rosso) con i giorni al prossimo cambio. */
export function CountdownBar({ entry, today, lead }: { entry: VaultEntryView; today: ISODate; lead: number }) {
  const { t } = useTranslation()
  const c = countdown(entry, today, lead)
  const label =
    c.daysLeft === null
      ? t('vault.countdown.never')
      : c.daysLeft < 0
        ? t('vault.countdown.dueSince', { count: -c.daysLeft })
        : c.daysLeft === 0
          ? t('vault.countdown.today')
          : t('vault.countdown.left', { count: c.daysLeft })
  return (
    <div className={`countdown lv-${c.level}`}>
      <div className="countdown-track">
        <div className="countdown-fill" style={{ width: `${Math.max(4, c.ratio * 100)}%` }} />
      </div>
      <span className="countdown-label">{label}</span>
    </div>
  )
}

interface RowProps {
  entry: VaultEntryView
  groups: VaultGroupView[]
  today: ISODate
  lead: number
  onEdit: (e: VaultEntryView) => void
  onNewPassword: (e: VaultEntryView) => void
}

export function VaultRow({ entry, groups, today, lead, onEdit, onNewPassword }: RowProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<'username' | 'password' | null>(null)
  const apply = window.dock.vault.apply

  const copy = async (field: 'username' | 'password') => {
    const r = await apply({ op: 'copy', id: entry.id, field })
    if (r.ok) {
      setCopied(field)
      window.setTimeout(() => setCopied(null), 1500)
    }
  }

  return (
    <li className="vault-row">
      <button className="vault-main" onClick={() => onEdit(entry)}>
        <span className="vault-avatar" aria-hidden="true">
          {entry.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="vault-text">
          <span className="dl-title">{entry.name}</span>
          {entry.username && <span className="dl-meta">{entry.username}</span>}
          <CountdownBar entry={entry} today={today} lead={lead} />
        </span>
      </button>
      <div className="vault-actions">
        {entry.username && (
          <button className="icon-btn" title={t('vault.actions.copyUser')} aria-label={t('vault.actions.copyUser')} onClick={() => void copy('username')}>
            {copied === 'username' ? <CheckIcon /> : <UserIcon />}
          </button>
        )}
        {entry.hasPassword && (
          <button
            className="icon-btn"
            title={t('vault.actions.copyPassword')}
            aria-label={t('vault.actions.copyPassword')}
            onClick={() => void copy('password')}
          >
            {copied === 'password' ? <CheckIcon /> : <KeyIcon />}
          </button>
        )}
        <RowMenu label={t('vault.actions.more')}>
          <button onClick={() => onNewPassword(entry)}>{t('vault.actions.newPassword')}</button>
          <button onClick={() => void apply({ op: 'resetCountdown', id: entry.id })}>{t('vault.actions.reset')}</button>
          <button onClick={() => onEdit(entry)}>{t('vault.actions.edit')}</button>
          {entry.url && <button onClick={() => void apply({ op: 'openUrl', id: entry.id })}>{t('vault.actions.openUrl')}</button>}
          {groups.length > 0 && <span className="menu-label">{t('vault.groups.moveTo')}</span>}
          {groups.length > 0 &&
            groups
              .filter((g) => g.id !== entry.groupId)
              .map((g) => (
                <button key={g.id} onClick={() => void apply({ op: 'move', id: entry.id, groupId: g.id })}>
                  <span className="group-dot" style={{ background: g.color }} aria-hidden="true" /> {g.name}
                </button>
              ))}
          {groups.length > 0 && entry.groupId && (
            <button onClick={() => void apply({ op: 'move', id: entry.id, groupId: null })}>{t('vault.groups.none')}</button>
          )}
          <DeleteButton onConfirm={() => void apply({ op: 'remove', id: entry.id })} />
        </RowMenu>
      </div>
    </li>
  )
}

/** Riga in sola lettura a cassaforte chiusa: nome e countdown (dai metadati). */
export function VaultRowLocked({
  entry,
  today,
  lead,
  onClick
}: {
  entry: VaultEntryView
  today: ISODate
  lead: number
  onClick?: () => void
}) {
  return (
    <li className={`vault-row locked ${onClick ? 'home-link' : ''}`} onClick={onClick}>
      <span className="vault-avatar" aria-hidden="true">
        {entry.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="vault-text">
        <span className="dl-title">{entry.name}</span>
        <CountdownBar entry={entry} today={today} lead={lead} />
      </span>
    </li>
  )
}

const icon = (d: string) => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const UserIcon = () => icon('M10 10a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM4 16.5c.8-2.8 3.2-4.2 6-4.2s5.2 1.4 6 4.2')
const KeyIcon = () => icon('M12.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM11.5 10l5 5M14 12.5l-1.5 1.5M15.7 14.2l-1.4 1.4')
const CheckIcon = () => icon('M4.5 10.5l3.5 3.5 7.5-8')
