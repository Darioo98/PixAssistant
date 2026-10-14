import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GROUP_COLORS,
  buildGroupTree,
  canMoveGroup,
  descendantsOf,
  flattenTree,
  type GroupNode,
  type VaultEntryView,
  type VaultGroupView
} from '@shared/vault'
import { DeleteButton, RowMenu } from '../RowMenu'

/**
 * Cartelle della cassaforte (categorie e sottocategorie), mostrate come un
 * albero: si aprono e chiudono, si creano e rinominano sul posto e si
 * riorganizzano trascinando password e cartelle.
 */

const COLLAPSED_KEY = 'dock.vault.collapsed'
const DRAG_ENTRY = 'application/x-dock-entry'
const DRAG_FOLDER = 'application/x-dock-folder'

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

export function FolderIcon({ color, open = false }: { color?: string; open?: boolean }) {
  return (
    <svg className="folder-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        d={open ? 'M2.5 6V4.5a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1V8M2.5 6v9a1 1 0 0 0 1 1h12l2-7.5H5z' : 'M2.5 4.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z'}
        fill={color ?? 'var(--text-muted)'}
        fillOpacity="0.25"
        stroke={color ?? 'var(--text-muted)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Scelta del colore di una cartella. */
function ColorChoice({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="swatches small" role="radiogroup" aria-label={t('vault.groups.color')} data-keep>
      {GROUP_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          data-keep
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

/** Elenco indentato delle cartelle (per "Sposta in…"). */
export function FolderMoveItems({
  groups,
  exclude,
  current,
  onPick
}: {
  groups: VaultGroupView[]
  /** Cartelle non selezionabili (es. la cartella stessa e le sue sottocartelle). */
  exclude?: Set<string>
  current: string | null
  onPick: (id: string | null) => void
}) {
  const { t } = useTranslation()
  const flat = flattenTree(buildGroupTree(groups))
  return (
    <>
      <span className="menu-label">{t('vault.groups.moveTo')}</span>
      {current !== null && <button onClick={() => onPick(null)}>{t('vault.groups.root')}</button>}
      {flat
        .filter((n) => n.group.id !== current && !exclude?.has(n.group.id))
        .map((n) => (
          <button key={n.group.id} style={{ paddingLeft: 10 + n.depth * 14 }} onClick={() => onPick(n.group.id)}>
            <FolderIcon color={n.group.color} /> {n.group.name}
          </button>
        ))}
    </>
  )
}

/** Riga per creare o rinominare una cartella direttamente nell'albero. */
function FolderNameInput({ depth, initial, onDone }: { depth: number; initial: string; onDone: (name: string | null) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial)
  return (
    <li className="folder-row editing" style={{ paddingLeft: 4 + depth * 16 }}>
      <FolderIcon />
      <input
        autoFocus
        value={name}
        maxLength={100}
        placeholder={t('vault.groups.namePlaceholder')}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => onDone(name.trim() || null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            e.stopPropagation()
            onDone(null)
          }
        }}
      />
    </li>
  )
}

interface TreeProps {
  entries: VaultEntryView[]
  groups: VaultGroupView[]
  /** Disegna una password alla profondità indicata. */
  renderEntry: (entry: VaultEntryView, depth: number) => ReactNode
  /** Cassaforte aperta: menu, creazione e trascinamento attivi. */
  editable: boolean
  onNewEntry?: (groupId: string | null) => void
  /** Cartella in cui creare la prossima cartella (null = primo livello, undefined = nessuna). */
  creatingIn?: string | null
  onCreated?: () => void
}

export function FolderTree({ entries, groups, renderEntry, editable, onNewEntry, creatingIn, onCreated }: TreeProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newIn, setNewIn] = useState<string | null | undefined>(undefined)
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null)
  const [dragging, setDragging] = useState(false)
  const tree = useMemo(() => buildGroupTree(groups), [groups])

  // Totale delle password contenute (sottocartelle comprese).
  const totals = useMemo(() => {
    const map = new Map<string, number>()
    for (const g of groups) {
      const ids = descendantsOf(g.id, groups)
      map.set(g.id, entries.filter((e) => e.groupId !== null && ids.has(e.groupId)).length)
    }
    return map
  }, [groups, entries])

  const creating = creatingIn !== undefined ? creatingIn : newIn
  const finishCreate = (parentId: string | null, name: string | null) => {
    setNewIn(undefined)
    onCreated?.()
    if (!name) return
    const color = GROUP_COLORS[groups.length % GROUP_COLORS.length]!
    void window.dock.vault.apply({ op: 'groupSave', name, color, parentId })
    if (parentId) expand(parentId)
  }

  const toggle = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]
    setCollapsed(next)
    saveCollapsed(next)
  }
  const expand = (id: string) => {
    if (!collapsed.includes(id)) return
    const next = collapsed.filter((x) => x !== id)
    setCollapsed(next)
    saveCollapsed(next)
  }

  // ---- Trascinamento ----
  const onDrop = (e: DragEvent, target: string | null) => {
    e.preventDefault()
    setDropTarget(null)
    setDragging(false)
    const entry = e.dataTransfer.getData(DRAG_ENTRY)
    const folder = e.dataTransfer.getData(DRAG_FOLDER)
    if (entry) void window.dock.vault.apply({ op: 'move', id: entry, groupId: target })
    else if (folder && folder !== target && canMoveGroup(folder, target, groups)) {
      void window.dock.vault.apply({ op: 'groupMove', id: folder, parentId: target })
    }
    if (target) expand(target)
  }
  const dropProps = (target: string | null) =>
    editable
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault()
            setDropTarget(target ?? 'root')
          },
          onDragLeave: () => setDropTarget(null),
          onDrop: (e: DragEvent) => onDrop(e, target)
        }
      : {}

  const renderNode = (node: GroupNode<VaultGroupView>): ReactNode => {
    const g = node.group
    const open = !collapsed.includes(g.id)
    const own = entries.filter((e) => e.groupId === g.id)
    if (renaming === g.id) {
      return (
        <FolderNameInput
          key={g.id}
          depth={node.depth}
          initial={g.name}
          onDone={(name) => {
            setRenaming(null)
            if (name && name !== g.name) void window.dock.vault.apply({ op: 'groupSave', id: g.id, name, color: g.color })
          }}
        />
      )
    }
    return [
      <li
        key={g.id}
        className={`folder-row ${dropTarget === g.id ? 'drop' : ''}`}
        style={{ paddingLeft: 4 + node.depth * 16 }}
        draggable={editable}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_FOLDER, g.id)
          setDragging(true)
        }}
        onDragEnd={() => setDragging(false)}
        {...dropProps(g.id)}
      >
        <button className="folder-toggle" aria-expanded={open} onClick={() => toggle(g.id)}>
          <span className="chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <FolderIcon color={g.color} open={open} />
          <span className="folder-name">{g.name}</span>
          <em>{totals.get(g.id) ?? 0}</em>
        </button>
        {editable && (
          <RowMenu label={t('vault.groups.more')}>
            <button onClick={() => onNewEntry?.(g.id)}>{t('vault.groups.newEntryHere')}</button>
            <button
              onClick={() => {
                expand(g.id)
                setNewIn(g.id)
              }}
            >
              {t('vault.groups.newSub')}
            </button>
            <button onClick={() => setRenaming(g.id)}>{t('vault.groups.rename')}</button>
            <span className="menu-label">{t('vault.groups.color')}</span>
            <ColorChoice value={g.color} onChange={(c) => void window.dock.vault.apply({ op: 'groupSave', id: g.id, name: g.name, color: c })} />
            <FolderMoveItems
              groups={groups}
              exclude={descendantsOf(g.id, groups)}
              current={g.parentId ?? null}
              onPick={(parentId) => void window.dock.vault.apply({ op: 'groupMove', id: g.id, parentId })}
            />
            <DeleteButton onConfirm={() => void window.dock.vault.apply({ op: 'groupRemove', id: g.id })} />
          </RowMenu>
        )}
      </li>,
      open && creating === g.id && <FolderNameInput key={`${g.id}-new`} depth={node.depth + 1} initial="" onDone={(n) => finishCreate(g.id, n)} />,
      ...(open ? node.children.map(renderNode) : []),
      ...(open ? own.map((e) => renderEntry(e, node.depth + 1)) : [])
    ]
  }

  const rootEntries = entries.filter((e) => e.groupId === null)

  return (
    <ul className="folder-tree">
      {creating === null && <FolderNameInput depth={0} initial="" onDone={(n) => finishCreate(null, n)} />}
      {tree.map(renderNode)}
      {rootEntries.map((e) => renderEntry(e, 0))}
      {editable && dragging && (
        <li className={`root-drop ${dropTarget === 'root' ? 'drop' : ''}`} {...dropProps(null)}>
          {t('vault.groups.dropRoot')}
        </li>
      )}
    </ul>
  )
}

/** Inizio del trascinamento di una password (dalla riga). */
export function entryDragProps(id: string, enabled: boolean) {
  return enabled
    ? {
        draggable: true,
        onDragStart: (e: DragEvent) => e.dataTransfer.setData(DRAG_ENTRY, id)
      }
    : {}
}

/** Selettore della cartella nel form di una voce, con creazione al volo. */
export function GroupSelect({ groups, value, onChange }: { groups: VaultGroupView[]; value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const flat = flattenTree(buildGroupTree(groups))
  const selected = groups.find((g) => g.id === value)

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
            void window.dock.vault.apply({ op: 'groupSave', name: name.trim(), color, parentId: value }).then((r) => {
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
      <option value="">{t('vault.groups.root')}</option>
      {flat.map((n) => (
        <option key={n.group.id} value={n.group.id}>
          {'   '.repeat(n.depth)}
          {n.depth > 0 ? '└ ' : ''}
          {n.group.name}
        </option>
      ))}
      <option value="__new">+ {selected ? t('vault.groups.newInside', { name: selected.name }) : t('vault.groups.new')}…</option>
    </select>
  )
}
