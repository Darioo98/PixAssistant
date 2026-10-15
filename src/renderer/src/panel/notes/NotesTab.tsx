import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { diffDays, type ISODate } from '@shared/dates'
import { noteTitle, PRIORITIES, type NoteItem, type Priority, type TodoItem } from '@shared/productivity'
import { useData, useToday } from '../../hooks'
import { formatDate } from '../../format'
import { DeleteButton, RowMenu } from '../RowMenu'
import { Markdown } from '../chat/Markdown'
import { takeFocus } from '../focus'
import './productivity.css'

type Segment = 'notes' | 'todos'

export function NotesTab() {
  const { t } = useTranslation()
  // Apertura dalla ricerca: sezione e nota richieste hanno la precedenza sull'ultima vista.
  const [focus] = useState(() => takeFocus('notes'))
  const [segment, setSegment] = useState<Segment>(() =>
    focus?.segment ?? (focus?.noteId ? 'notes' : sessionStorageGet('pix.notes.segment') === 'todos' ? 'todos' : 'notes')
  )
  const pick = (s: Segment) => {
    setSegment(s)
    sessionStorageSet('pix.notes.segment', s)
  }
  return (
    <div className="productivity">
      <div className="segmented" role="tablist">
        {(['notes', 'todos'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={segment === s} className={segment === s ? 'on' : ''} onClick={() => pick(s)}>
            {s === 'notes' ? t('notes.tabNotes') : t('notes.tabTodos')}
          </button>
        ))}
      </div>
      {segment === 'notes' ? <Notes initialOpen={focus?.noteId ?? null} /> : <Todos />}
    </div>
  )
}

// ======================= Note =======================

function Notes({ initialOpen }: { initialOpen: string | null }) {
  const { t } = useTranslation()
  const notes = useData('notes')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | 'new' | null>(initialOpen)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!notes) return []
    return q ? notes.filter((n) => `${n.title}\n${n.body}`.toLowerCase().includes(q)) : notes
  }, [notes, query])

  if (!notes) return null
  if (open) {
    const note = open === 'new' ? undefined : notes.find((n) => n.id === open)
    return <NoteEditor key={open} note={note} onClose={() => setOpen(null)} onCreated={(id) => setOpen(id)} />
  }

  return (
    <>
      <div className="toolbar">
        <input className="search" type="search" value={query} placeholder={t('notes.search')} aria-label={t('notes.search')} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn primary" onClick={() => setOpen('new')}>
          + {t('notes.new')}
        </button>
      </div>
      {filtered.length === 0 ? (
        <p className="empty">{notes.length === 0 ? t('notes.empty') : t('notes.noResults')}</p>
      ) : (
        <ul className="note-list">
          {filtered.map((n) => (
            <li key={n.id}>
              <button className="note-item" onClick={() => setOpen(n.id)}>
                <span className="dl-title">
                  {n.pinned && <span aria-hidden="true">📌 </span>}
                  {noteTitle(n, t('notes.untitled'))}
                </span>
                <span className="dl-meta">{n.body.replace(/\s+/g, ' ').slice(0, 90)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

const AUTOSAVE_MS = 600

/** Editor con salvataggio automatico (nessun pulsante "Salva"). */
function NoteEditor({ note, onClose, onCreated }: { note?: NoteItem; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [preview, setPreview] = useState(false)
  const [saved, setSaved] = useState(true)
  const idRef = useRef(note?.id)
  const timer = useRef<number | undefined>(undefined)

  const save = async (next = { title, body, pinned }) => {
    if (!idRef.current && !next.title.trim() && !next.body.trim()) return
    const r = await window.pix.data.apply('notes', { op: 'save', id: idRef.current, note: next })
    if (r.ok && r.id && !idRef.current) {
      idRef.current = r.id
      onCreated(r.id)
    }
    setSaved(true)
  }

  const schedule = (next: { title: string; body: string; pinned: boolean }) => {
    setSaved(false)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(next), AUTOSAVE_MS)
  }

  // Salva le modifiche pendenti quando si esce dall'editor.
  const latest = useRef({ title, body, pinned, saved })
  latest.current = { title, body, pinned, saved }
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      const l = latest.current
      if (!l.saved) void save({ title: l.title, body: l.body, pinned: l.pinned })
    },
    []
  )

  return (
    <div className="note-editor">
      <div className="toolbar">
        <button className="btn subtle" onClick={onClose}>
          ‹ {t('notes.back')}
        </button>
        <span className="hint">{saved ? t('notes.saved') : '…'}</span>
        <span className="spacer" />
        <button
          className="btn subtle"
          onClick={() => {
            setPinned(!pinned)
            schedule({ title, body, pinned: !pinned })
          }}
        >
          {pinned ? t('notes.unpin') : t('notes.pin')}
        </button>
        <button className="btn subtle" onClick={() => setPreview(!preview)}>
          {preview ? t('notes.edit') : t('notes.preview')}
        </button>
        {idRef.current && (
          <RowMenu label={t('todos.more')}>
            <DeleteButton
              onConfirm={() => {
                window.clearTimeout(timer.current)
                latest.current.saved = true
                setSaved(true)
                void window.pix.data.apply('notes', { op: 'remove', id: idRef.current! }).then(onClose)
              }}
            />
          </RowMenu>
        )}
      </div>
      <input
        className="note-title"
        value={title}
        maxLength={200}
        placeholder={t('notes.titlePlaceholder')}
        onChange={(e) => {
          setTitle(e.target.value)
          schedule({ title: e.target.value, body, pinned })
        }}
      />
      {preview ? (
        <div className="note-preview">
          <Markdown text={body} />
        </div>
      ) : (
        <textarea
          className="note-body"
          autoFocus={!note}
          value={body}
          placeholder={t('notes.bodyPlaceholder')}
          onChange={(e) => {
            setBody(e.target.value)
            schedule({ title, body: e.target.value, pinned })
          }}
        />
      )}
    </div>
  )
}

// ======================= To-do =======================

function Todos() {
  const { t, i18n } = useTranslation()
  const todos = useData('todos')
  const today = useToday()
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [forToday, setForToday] = useState(false)
  const [showDone, setShowDone] = useState(false)

  if (!todos) return null

  const add = () => {
    if (!text.trim()) return
    void window.pix.data.apply('todos', { op: 'save', todo: { text: text.trim(), due: due || null, priority, today: forToday } })
    setText('')
    setDue('')
    setPriority('normal')
    setForToday(false)
  }

  const open = todos.filter((x) => !x.done)
  const groups: Array<[string, TodoItem[]]> = [
    ['today', open.filter((x) => x.today || (x.due !== null && diffDays(x.due, today) >= 0))],
    ['upcoming', open.filter((x) => !x.today && x.due !== null && diffDays(x.due, today) < 0)],
    ['nodate', open.filter((x) => !x.today && x.due === null)]
  ]
  const done = todos.filter((x) => x.done)

  return (
    <>
      <form
        className="todo-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={text} maxLength={1000} placeholder={t('todos.placeholder')} aria-label={t('todos.placeholder')} onChange={(e) => setText(e.target.value)} />
        <div className="inline">
          <input type="date" value={due} aria-label={t('todos.due')} onChange={(e) => setDue(e.target.value)} />
          <select value={priority} aria-label={t('todos.priority')} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`todos.priorities.${p}`)}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={forToday} onChange={(e) => setForToday(e.target.checked)} /> {t('todos.today')}
          </label>
          <button className="btn primary" type="submit" disabled={!text.trim()}>
            {t('todos.add')}
          </button>
        </div>
      </form>

      {open.length === 0 && <p className="empty">{t('todos.empty')}</p>}
      {groups.map(([key, items]) =>
        items.length === 0 ? null : (
          <section key={key} className="todo-group">
            <h3>{t(`todos.groups.${key}`)}</h3>
            <ul className="todo-list">
              {items.map((x) => (
                <TodoRow key={x.id} todo={x} today={today} lang={i18n.language} />
              ))}
            </ul>
          </section>
        )
      )}
      {done.length > 0 && (
        <section className="todo-group">
          <h3>
            <button className="btn subtle" onClick={() => setShowDone(!showDone)}>
              {showDone ? '▾' : '▸'} {t('todos.groups.done')} ({done.length})
            </button>
            {showDone && (
              <button className="btn subtle" onClick={() => void window.pix.data.apply('todos', { op: 'clearDone' })}>
                {t('todos.clearDone')}
              </button>
            )}
          </h3>
          {showDone && (
            <ul className="todo-list">
              {done.map((x) => (
                <TodoRow key={x.id} todo={x} today={today} lang={i18n.language} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}

export function TodoRow({ todo, today, lang, compact = false }: { todo: TodoItem; today: ISODate; lang: string; compact?: boolean }) {
  const { t } = useTranslation()
  const overdue = !todo.done && todo.due !== null && diffDays(todo.due, today) > 0
  return (
    <li className={`todo-row p-${todo.priority} ${todo.done ? 'done' : ''}`}>
      <input
        type="checkbox"
        checked={todo.done}
        aria-label={todo.text}
        onChange={() => void window.pix.data.apply('todos', { op: 'toggle', id: todo.id })}
      />
      <span className="todo-text">
        {todo.text}
        {todo.due && <em className={overdue ? 'late' : ''}> · {formatDate(todo.due, lang, { day: 'numeric', month: 'short' })}</em>}
      </span>
      {!compact && (
        <RowMenu label={t('todos.more')}>
          {!todo.done && (
            <button
              onClick={() =>
                void window.pix.data.apply('todos', {
                  op: 'save',
                  id: todo.id,
                  todo: { text: todo.text, due: todo.due, priority: todo.priority, today: !todo.today }
                })
              }
            >
              {t('todos.today')}: {todo.today ? '✓' : '—'}
            </button>
          )}
          <DeleteButton onConfirm={() => void window.pix.data.apply('todos', { op: 'remove', id: todo.id })} />
        </RowMenu>
      )}
    </li>
  )
}

function sessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function sessionStorageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // preferenza non essenziale
  }
}
