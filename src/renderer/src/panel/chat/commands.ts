import type { TFunction } from 'i18next'
import type { ChatCommand } from '@shared/commands'
import { parseLocal } from '@shared/productivity'
import { formatDate } from '../../format'
import { openSearch, requestFocus } from '../focus'

export interface CommandResult {
  ok: boolean
  text: string
  /** Azione facoltativa ("Apri") mostrata accanto all'esito. */
  open?: () => void
  /** Mostra l'elenco dei comandi. */
  help?: boolean
}

/** Esegue un comando rapido in locale, con le stesse API del pannello: l'AI non vede nulla. */
export async function runCommand(cmd: ChatCommand, t: TFunction, lang: string): Promise<CommandResult> {
  const failed = { ok: false, text: t('commands.failed') }
  switch (cmd.kind) {
    case 'help':
      return { ok: true, text: t('commands.helpTitle'), help: true }
    case 'search':
      openSearch(cmd.query)
      return { ok: true, text: t('commands.searching') }
    case 'note': {
      const r = await window.pix.data.apply('notes', { op: 'save', note: { title: '', body: cmd.text, pinned: false } })
      if (!r.ok) return failed
      return { ok: true, text: t('commands.noteSaved'), open: () => requestFocus({ tab: 'notes', noteId: r.id }) }
    }
    case 'todo': {
      const r = await window.pix.data.apply('todos', { op: 'save', todo: { text: cmd.text, due: cmd.due, priority: 'normal', today: false } })
      if (!r.ok) return failed
      return {
        ok: true,
        text: cmd.due ? t('commands.todoSavedDue', { date: formatDate(cmd.due, lang) }) : t('commands.todoSaved'),
        open: () => requestFocus({ tab: 'notes', segment: 'todos' })
      }
    }
    case 'reminder': {
      const r = await window.pix.data.apply('reminders', { op: 'save', text: cmd.text, at: cmd.at, repeat: 'none' })
      if (!r.ok) return failed
      const when = parseLocal(cmd.at).toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      return { ok: true, text: t('commands.reminderSaved', { when }), open: () => requestFocus({ tab: 'timers' }) }
    }
    case 'deadline': {
      const ok = await window.pix.deadlines.apply({
        op: 'save',
        input: { title: cmd.title, date: cmd.date, recurrence: { unit: 'none', every: 1 }, leadDays: null, category: '', notes: '' }
      })
      if (!ok) return failed
      return { ok: true, text: t('commands.deadlineSaved', { date: formatDate(cmd.date, lang) }), open: () => requestFocus({ tab: 'deadlines' }) }
    }
    case 'error':
      return { ok: false, text: t(`commands.errors.${cmd.code}`, { command: cmd.command }) }
  }
}
