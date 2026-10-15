/**
 * Ricerca globale: cerca in note, to-do, promemoria, scadenze, link, appunti
 * e nei nomi delle voci della cassaforte (mai nelle password). Tutto in locale.
 */
export const SEARCH_GROUPS = ['notes', 'todos', 'reminders', 'deadlines', 'links', 'clipboard', 'vault'] as const
export type SearchGroup = (typeof SEARCH_GROUPS)[number]

export interface SearchDoc {
  group: SearchGroup
  id: string
  title: string
  /** Testo in cui cercare oltre al titolo (es. corpo della nota). */
  body?: string
  /** Riga secondaria fissa (es. data, percorso della cartella). */
  detail?: string
}

export interface SearchHit extends SearchDoc {
  /** Estratto del testo attorno alla parola trovata, se non è nel titolo. */
  snippet?: string
  score: number
}

/** Minuscole e senza accenti: "Città" trova "citta". */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function searchTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

/** Estratto di circa `max` caratteri attorno alla prima parola trovata. */
export function snippetOf(text: string, terms: string[], max = 90): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim()
  const folded = fold(flat)
  let at = -1
  for (const term of terms) {
    const i = folded.indexOf(term)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return undefined
  const start = Math.max(0, at - Math.floor(max / 3))
  const end = Math.min(flat.length, start + max)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

/**
 * Tutte le parole devono comparire nel titolo o nel testo. Prima i risultati
 * con le parole nel titolo, poi quelli che iniziano con la ricerca.
 */
export function search(docs: SearchDoc[], query: string, perGroup = 6): SearchHit[] {
  const terms = searchTerms(query)
  if (!terms.length) return []
  const hits: SearchHit[] = []
  for (const doc of docs) {
    const title = fold(doc.title)
    const all = `${title}\n${fold(doc.body ?? '')}\n${fold(doc.detail ?? '')}`
    if (!terms.every((t) => all.includes(t))) continue
    let score = 0
    for (const t of terms) if (title.includes(t)) score += 2
    if (title.startsWith(terms[0]!)) score += 1
    const inTitle = terms.every((t) => title.includes(t))
    hits.push({ ...doc, score, snippet: inTitle || !doc.body ? undefined : snippetOf(doc.body, terms) })
  }
  hits.sort((a, b) => SEARCH_GROUPS.indexOf(a.group) - SEARCH_GROUPS.indexOf(b.group) || b.score - a.score || a.title.localeCompare(b.title))
  const count = new Map<SearchGroup, number>()
  return hits.filter((h) => {
    const n = (count.get(h.group) ?? 0) + 1
    count.set(h.group, n)
    return n <= perGroup
  })
}
