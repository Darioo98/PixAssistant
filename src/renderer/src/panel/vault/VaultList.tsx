import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ISODate } from '@shared/dates'
import { countdown, type VaultEntryView, type VaultGroupView } from '@shared/vault'
import { DeleteButton, RowMenu } from '../RowMenu'
import { FolderMoveItems, entryDragProps } from './VaultGroups'

/**
 * Countdown compatto: pallino colorato (verde, giallo, rosso) e giorni al
 * prossimo cambio; la descrizione completa è nel tooltip.
 */
export function CountdownBadge({ entry, today, lead }: { entry: VaultEntryView; today: ISODate; lead: number }) {
  const { t } = useTranslation()
  const c = countdown(entry, today, lead)
  const full =
    c.daysLeft === null
      ? t('vault.countdown.never')
      : c.daysLeft < 0
        ? t('vault.countdown.dueSince', { count: -c.daysLeft })
        : c.daysLeft === 0
          ? t('vault.countdown.today')
          : t('vault.countdown.left', { count: c.daysLeft })
  const short =
    c.daysLeft === null
      ? t('vault.countdown.short.never')
      : c.daysLeft < 0
        ? t('vault.countdown.short.overdue', { count: -c.daysLeft })
        : c.daysLeft === 0
          ? t('vault.countdown.short.today')
          : t('vault.countdown.short.days', { count: c.daysLeft })
  return (
    <span className={`cd-badge lv-${c.level}`} title={full} aria-label={full}>
      <i aria-hidden="true" />
      {short}
    </span>
  )
}

interface RowProps {
  entry: VaultEntryView
  groups: VaultGroupView[]
  /** Livello nell'albero delle cartelle. */
  depth?: number
  /** Percorso della cartella, mostrato nei risultati di ricerca. */
  path?: string
  today: ISODate
  lead: number
  onEdit: (e: VaultEntryView) => void
  onNewPassword: (e: VaultEntryView) => void
}

/** Riga compatta su una sola linea: iniziale, nome, utente, countdown e copia. */
export function VaultRow({ entry, groups, depth = 0, path, today, lead, onEdit, onNewPassword }: RowProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<'username' | 'password' | null>(null)
  const apply = window.pix.vault.apply

  const copy = async (field: 'username' | 'password') => {
    const r = await apply({ op: 'copy', id: entry.id, field })
    if (r.ok) {
      setCopied(field)
      window.setTimeout(() => setCopied(null), 1500)
    }
  }

  const sub = [path, entry.username].filter(Boolean).join(' · ')

  return (
    <li className="vault-row compact" style={{ paddingLeft: 4 + depth * 16 }} {...entryDragProps(entry.id, true)}>
      <button className="vault-main" onClick={() => onEdit(entry)} title={sub ? `${entry.name} — ${sub}` : entry.name}>
        <span className="vault-avatar" aria-hidden="true">
          {entry.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="vault-line">
          <span className="vault-name">{entry.name}</span>
          {sub && <span className="vault-sub">{sub}</span>}
        </span>
      </button>
      <CountdownBadge entry={entry} today={today} lead={lead} />
      <div className="vault-actions">
        {entry.username && (
          <button
            className="icon-btn small hover-only"
            title={t('vault.actions.copyUser')}
            aria-label={t('vault.actions.copyUser')}
            onClick={() => void copy('username')}
          >
            {copied === 'username' ? <CheckIcon /> : <UserIcon />}
          </button>
        )}
        {entry.hasPassword && (
          <button
            className="icon-btn small"
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
          {groups.length > 0 && (
            <FolderMoveItems groups={groups} current={entry.groupId} onPick={(groupId) => void apply({ op: 'move', id: entry.id, groupId })} />
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
  depth = 0,
  onClick
}: {
  entry: VaultEntryView
  today: ISODate
  lead: number
  depth?: number
  onClick?: () => void
}) {
  return (
    <li className={`vault-row compact locked ${onClick ? 'home-link' : ''}`} style={{ paddingLeft: 8 + depth * 16 }} onClick={onClick}>
      <span className="vault-avatar" aria-hidden="true">
        {entry.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="vault-line">
        <span className="vault-name">{entry.name}</span>
      </span>
      <CountdownBadge entry={entry} today={today} lead={lead} />
    </li>
  )
}

const icon = (d: string) => (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const UserIcon = () => icon('M10 10a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM4 16.5c.8-2.8 3.2-4.2 6-4.2s5.2 1.4 6 4.2')
const KeyIcon = () => icon('M12.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM11.5 10l5 5M14 12.5l-1.5 1.5M15.7 14.2l-1.4 1.4')
const CheckIcon = () => icon('M4.5 10.5l3.5 3.5 7.5-8')
