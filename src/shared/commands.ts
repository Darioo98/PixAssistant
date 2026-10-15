import { addDays, formatISODate, isValidISODate, toISODate, type ISODate } from './dates'

/**
 * Comandi rapidi della chat ("/nota …", "/promemoria domani 15:30 …").
 * Li interpreta l'app, in locale: non passano dall'AI.
 */
export type ChatCommand =
  | { kind: 'note'; text: string }
  | { kind: 'todo'; text: string; due: ISODate | null }
  | { kind: 'reminder'; text: string; at: string }
  | { kind: 'deadline'; title: string; date: ISODate }
  | { kind: 'search'; query: string }
  | { kind: 'help' }
  | { kind: 'error'; code: 'missingText' | 'missingTime' | 'missingDate' | 'pastTime' | 'unknown'; command: string }

export const COMMANDS = ['note', 'todo', 'reminder', 'deadline', 'search', 'help'] as const
export type CommandName = (typeof COMMANDS)[number]

/** Nomi accettati (italiano e inglese); il primo di ogni lingua è quello suggerito. */
export const COMMAND_ALIASES: Record<CommandName, { it: string[]; en: string[] }> = {
  note: { it: ['nota', 'appunto'], en: ['note'] },
  todo: { it: ['todo', 'fare', 'attività'], en: ['todo', 'task'] },
  reminder: { it: ['promemoria', 'ricorda', 'ricordami'], en: ['remind', 'reminder'] },
  deadline: { it: ['scadenza'], en: ['deadline', 'due'] },
  search: { it: ['cerca', 'trova'], en: ['search', 'find'] },
  help: { it: ['aiuto', 'comandi'], en: ['help', 'commands'] }
}

const BY_ALIAS = new Map<string, CommandName>()
for (const name of COMMANDS) for (const a of [...COMMAND_ALIASES[name].it, ...COMMAND_ALIASES[name].en, ...(name === 'help' ? ['?'] : [])]) BY_ALIAS.set(norm(a), name)

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** true se il testo va interpretato come comando ("//" manda all'AI un testo che inizia con "/"). */
export function isCommandInput(text: string): boolean {
  return /^\/(?!\/)\S/.test(text.trim())
}

/** Comandi che iniziano con il prefisso digitato (per i suggerimenti). */
export function suggestCommands(text: string, lang: 'it' | 'en'): Array<{ name: CommandName; alias: string }> {
  const m = /^\/(\S*)$/.exec(text.trim())
  if (!m) return []
  const prefix = norm(m[1] ?? '')
  const out: Array<{ name: CommandName; alias: string }> = []
  for (const name of COMMANDS) {
    const aliases = [...COMMAND_ALIASES[name][lang], ...COMMAND_ALIASES[name][lang === 'it' ? 'en' : 'it']]
    const hit = aliases.find((a) => norm(a).startsWith(prefix))
    if (hit) out.push({ name, alias: hit })
  }
  return out
}

const WEEKDAYS: Record<string, number> = {
  domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
}

interface When {
  date: ISODate | null
  /** Minuti dalla mezzanotte. */
  time: number | null
  /** Istante assoluto ("tra 20 minuti"). */
  at: Date | null
}

/**
 * Legge data e ora all'inizio del testo, in qualsiasi ordine:
 * oggi, domani, dopodomani, lunedì…, 25/12, 25/12/2027, 15:30, alle 9, tra 20 min, tra 2 ore.
 */
export function parseWhen(input: string, now: Date): { when: When; rest: string } {
  const today = toISODate(now)
  const when: When = { date: null, time: null, at: null }
  let rest = input.trim()
  for (let guard = 0; guard < 4 && rest; guard++) {
    let m: RegExpExecArray | null
    const lower = norm(rest)
    if ((m = /^(oggi|today)\b\s*/.exec(lower))) when.date = today
    else if ((m = /^(dopodomani)\b\s*/.exec(lower))) when.date = addDays(today, 2)
    else if ((m = /^(domani|tomorrow)\b\s*/.exec(lower))) when.date = addDays(today, 1)
    else if ((m = /^(?:tra|fra|in)\s+(\d{1,4})\s*(minuti|minuto|min|m|ore|ora|h|hours|hour)\b\s*/.exec(lower))) {
      const n = Number(m[1])
      const ms = /^(ore|ora|h|hours|hour)$/.test(m[2]!) ? n * 3_600_000 : n * 60_000
      when.at = new Date(now.getTime() + ms)
    } else if ((m = timeMatch(lower))) {
      when.time = Number(m[1]) * 60 + Number(m[2] ?? 0)
    } else if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b\s*/.exec(lower))) {
      const d = Number(m[1])
      const mo = Number(m[2])
      let y = m[3] ? Number(m[3]) : now.getFullYear()
      if (y < 100) y += 2000
      if (mo < 1 || mo > 12 || d < 1 || d > 31) break
      let iso = formatISODate(y, mo, d)
      if (!isValidISODate(iso)) break
      // Senza anno, una data già passata si intende l'anno prossimo.
      if (!m[3] && iso < today) iso = formatISODate(y + 1, mo, d)
      when.date = iso
    } else if ((m = /^([a-z]+)\b\s*/.exec(lower)) && m[1]! in WEEKDAYS) {
      const target = WEEKDAYS[m[1]!]!
      const diff = (target - now.getDay() + 7) % 7 || 7
      when.date = addDays(today, diff)
    } else break
    rest = rest.slice(m[0].length)
  }
  return { when, rest: rest.trim() }
}

/** Ora valida ("15:30", "15.30", "alle 9", "at 9"): altrimenti null, così "25.12" resta una data. */
function timeMatch(lower: string): RegExpExecArray | null {
  const m = /^(?:alle\s+|all'|at\s+|ore\s+)?(\d{1,2})(?:[:.](\d{2}))?\b\s*/.exec(lower)
  if (!m) return null
  if (m[2] === undefined && !/^(alle|all'|at|ore)\s*/.test(lower)) return null
  if (Number(m[1]) > 23 || Number(m[2] ?? 0) > 59) return null
  // "25/12" non è un'ora: dopo le cifre non deve seguire un separatore di data.
  if (/^[/-]/.test(lower.slice(m[0].trimEnd().length))) return null
  return m
}

const pad = (n: number) => String(n).padStart(2, '0')
const localAt = (d: Date) => `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`

export function parseCommand(input: string, now: Date): ChatCommand | null {
  const text = input.trim()
  if (!isCommandInput(text)) return null
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text)!
  const word = m[1]!
  const args = m[2]!.trim()
  const name = BY_ALIAS.get(norm(word))
  if (!name) return { kind: 'error', code: 'unknown', command: word }

  switch (name) {
    case 'help':
      return { kind: 'help' }
    case 'search':
      return { kind: 'search', query: args }
    case 'note':
      return args ? { kind: 'note', text: args } : { kind: 'error', code: 'missingText', command: word }
    case 'todo': {
      const { when, rest } = parseWhen(args, now)
      if (!rest) return { kind: 'error', code: 'missingText', command: word }
      return { kind: 'todo', text: rest, due: when.date ?? (when.at ? toISODate(when.at) : null) }
    }
    case 'deadline': {
      const { when, rest } = parseWhen(args, now)
      if (!rest) return { kind: 'error', code: 'missingText', command: word }
      if (!when.date) return { kind: 'error', code: 'missingDate', command: word }
      return { kind: 'deadline', title: rest, date: when.date }
    }
    case 'reminder': {
      const { when, rest } = parseWhen(args, now)
      if (!rest) return { kind: 'error', code: 'missingText', command: word }
      if (when.at) return { kind: 'reminder', text: rest, at: localAt(when.at) }
      if (when.time === null && when.date === null) return { kind: 'error', code: 'missingTime', command: word }
      const time = when.time ?? 9 * 60
      let date = when.date ?? toISODate(now)
      const minutesNow = now.getHours() * 60 + now.getMinutes()
      // Solo l'ora, già passata: si intende domani.
      if (!when.date && time <= minutesNow) date = addDays(date, 1)
      if (date === toISODate(now) && time <= minutesNow) return { kind: 'error', code: 'pastTime', command: word }
      return { kind: 'reminder', text: rest, at: `${date}T${pad(Math.floor(time / 60))}:${pad(time % 60)}` }
    }
  }
}
