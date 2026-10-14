import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GROUP_COLORS, type VaultEntryView, type VaultGroupView } from '@shared/vault'
import { DeleteButton } from '../RowMenu'

/** Filtro: tutte, una raccolta, oppure senza raccolta. */
export type GroupFilter = 'all' | 'none' | string

const FILTER_KEY = 'dock.vault.filter'
const COLLAPSED_KEY = 'dock.vault.collapsed'

export function loadFilter(): GroupFilter {
  try {
    return localStorage.getItem(FILTER_KEY) ?? 'all'
  } catch {
    return 'all'
  }
}

export function saveFilter(f: GroupFilter): void {
  try {
    localStorage.setItem(FILTER_KEY, f)
  } catch {
    // preferenza non essenziale
  }
}

export function loadCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function saveCollapsed(ids: string[]): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids))
  } catch {
    // preferenza non essenziale
  }
}

export function GroupDot({ color }: { color?: string }) {
  return <span className="group-dot" style={{ background: color ?? 'var(--text-muted)' }} aria-hidden="true" />
}

/** Barra dei filtri per raccolta, con il numero di voci. */
export function GroupChips({
  groups,
  entries,
  filter,
  onFilter,
  onManage
}: {
  groups: VaultGroupView[]
  entries: VaultEntryView[]
  filter: GroupFilter
  onFilter: (f: GroupFilter) => void
  onManage?: () => void
}) {
  const { t } = useTranslation()
  const count = (id: string | null) => entries.filter((e) => e.groupId === id).length
  const none = count(null)
  return (
    <div className="filters group-chips">
      <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => onFilter('all')}>
        {t('vault.groups.all')} <em>{entries.length}</em>
      </button>
      {groups.map((g) => (
        <button key={g.id} className={`chip ${filter === g.id ? 'on' : ''}`} onClick={() => onFilter(g.id)}>
          <GroupDot color={g.color} /> {g.name} <em>{count(g.id)}</em>
        </button>
      ))}
      {groups.length > 0 && none > 0 && (
        <button className={`chip ${filter === 'none' ? 'on' : ''}`} onClick={() => onFilter('none')}>
          {t('vault.groups.none')} <em>{none}</em>
        </button>
      )}
      {onManage && (
        <button className="chip subtle-chip" onClick={onManage}>
          {groups.length === 0 ? `+ ${t('vault.groups.new')}` : t('vault.groups.manage')}
        </button>
      )}
    </div>
  )
}

/** Scelta del colore di una raccolta. */
function ColorChoice({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="swatches small" role="radiogroup" aria-label={t('vault.groups.color')}>
      {GROUP_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toUpperCase() === c}
          className={`swatch ${value.toUpperCase() === c ? 'selected' : ''}`}
          style={{ background: c }}
          aria-label={c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )
}

/** Crea, rinomina, ricolora ed elimina le raccolte. */
export function GroupManager({ groups, entries, onClose }: { groups: VaultGroupView[]; entries: VaultEntryView[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(GROUP_COLORS[groups.length % GROUP_COLORS.length]!)

  return (
    <div className="dl-form group-manager">
      <div className="toolbar">
        <h2>{t('vault.groups.title')}</h2>
        <button className="btn" onClick={onClose}>
          {t('vault.setup.done')}
        </button>
      </div>
      <p className="hint">{t('vault.groups.hint')}</p>

      <form
        className="group-new"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          void window.dock.vault.apply({ op: 'groupSave', name: name.trim(), color }).then(() => {
            setName('')
            setColor(GROUP_COLORS[(groups.length + 1) % GROUP_COLORS.length]!)
          })
        }}
      >
        <div className="inline">
          <GroupDot color={color} />
          <input className="grow" value={name} maxLength={100} placeholder={t('vault.groups.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            {t('vault.groups.add')}
          </button>
        </div>
        <ColorChoice value={color} onChange={setColor} />
      </form>

      <ul className="group-list">
        {groups.map((g) => (
          <GroupRow key={g.id} group={g} count={entries.filter((e) => e.groupId === g.id).length} />
        ))}
      </ul>
    </div>
  )
}

function GroupRow({ group, count }: { group: VaultGroupView; count: number }) {
  const { t } = useTranslation()
  const [name, setName] = useState(group.name)
  const [editing, setEditing] = useState(false)
  const save = (patch: { name?: string; color?: string }) =>
    void window.dock.vault.apply({ op: 'groupSave', id: group.id, name: patch.name ?? group.name, color: patch.color ?? group.color })

  return (
    <li className="group-row">
      <div className="inline">
        <GroupDot color={group.color} />
        {editing ? (
          <input
            className="grow"
            autoFocus
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (name.trim() && name.trim() !== group.name) save({ name: name.trim() })
              else setName(group.name)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button className="group-name" onClick={() => setEditing(true)} title={t('vault.groups.rename')}>
            {group.name}
          </button>
        )}
        <span className="dl-meta">{t('vault.groups.count', { count })}</span>
        <DeleteButton className="btn subtle danger-text" onConfirm={() => void window.dock.vault.apply({ op: 'groupRemove', id: group.id })} />
      </div>
      <ColorChoice value={group.color} onChange={(c) => save({ color: c })} />
    </li>
  )
}

/** Selettore della raccolta nel form di una voce, con creazione al volo. */
export function GroupSelect({ groups, value, onChange }: { groups: VaultGroupView[]; value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  if (creating) {
    return (
      <div className="inline">
        <input
          className="grow"
          autoFocus
          value={name}
          maxLength={100}
          placeholder={t('vault.groups.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setCreating(false)
            }
          }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!name.trim()}
          onClick={() => {
            const color = GROUP_COLORS[groups.length % GROUP_COLORS.length]!
            void window.dock.vault.apply({ op: 'groupSave', name: name.trim(), color }).then((r) => {
              if (r.ok && r.value) onChange(r.value)
              setCreating(false)
              setName('')
            })
          }}
        >
          {t('vault.groups.add')}
        </button>
        <button type="button" className="btn subtle" onClick={() => setCreating(false)}>
          {t('common.cancel')}
        </button>
      </div>
    )
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '__new') setCreating(true)
        else onChange(e.target.value || null)
      }}
    >
      <option value="">{t('vault.groups.none')}</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
      <option value="__new">+ {t('vault.groups.new')}…</option>
    </select>
  )
}
