import { describe, expect, it } from 'vitest'
import { search, snippetOf, type SearchDoc } from '@shared/search'

const docs: SearchDoc[] = [
  { group: 'notes', id: 'n1', title: 'Ricetta', body: 'Per la torta di mele servono farina, uova e mele renette.' },
  { group: 'notes', id: 'n2', title: 'Mele da comprare', body: '' },
  { group: 'vault', id: 'v1', title: 'Città metropolitana', detail: 'Lavoro › Comune' },
  { group: 'todos', id: 't1', title: 'Chiamare il comune' },
  { group: 'clipboard', id: 'c1', title: 'qualcosa', body: 'qualcosa' }
]

describe('ricerca globale', () => {
  it('trova in titolo, testo e dettaglio, senza badare ad accenti e maiuscole', () => {
    expect(search(docs, 'citta').map((h) => h.id)).toEqual(['v1'])
    expect(search(docs, 'COMUNE').map((h) => h.id)).toEqual(['t1', 'v1'])
    expect(search(docs, '')).toEqual([])
  })

  it('richiede tutte le parole e mette prima chi le ha nel titolo', () => {
    const hits = search(docs, 'mele')
    expect(hits.map((h) => h.id)).toEqual(['n2', 'n1'])
    expect(hits[1]!.snippet).toContain('mele')
    expect(search(docs, 'torta uova').map((h) => h.id)).toEqual(['n1'])
    expect(search(docs, 'torta pere')).toEqual([])
  })

  it('limita i risultati per gruppo e crea estratti leggibili', () => {
    const many = Array.from({ length: 10 }, (_, i): SearchDoc => ({ group: 'links', id: `l${i}`, title: `sito ${i}` }))
    expect(search(many, 'sito', 4)).toHaveLength(4)
    expect(snippetOf('a '.repeat(100) + 'parola finale', ['parola'], 30)).toMatch(/^….*parola/)
  })
})
