import { describe, expect, it } from 'vitest'
import { mergeItems, nextRevision, tombstone, type SyncItem } from '@shared/sync'

type Note = { text: string }
let n = 0
const ctx = (deviceId: string, now: number) => ({ deviceId, now, rev: `r${++n}` })

describe('mergeItems', () => {
  it("tiene la versione più recente e non segnala conflitti se è un'antenata", () => {
    const v1 = nextRevision<Note>(undefined, { id: 'a', text: 'uno' }, ctx('pc1', 100))
    const v2 = nextRevision<Note>(v1, { id: 'a', text: 'due' }, ctx('pc2', 200))
    const { items, conflicts } = mergeItems<Note>([v1], [v2])
    expect(items.get('a')?.text).toBe('due')
    expect(conflicts).toHaveLength(0)
  })

  it('segnala le modifiche concorrenti su due PC, senza perderle', () => {
    const base = nextRevision<Note>(undefined, { id: 'a', text: 'base' }, ctx('pc1', 100))
    const onPc1 = nextRevision<Note>(base, { id: 'a', text: 'pc1' }, ctx('pc1', 300))
    const onPc2 = nextRevision<Note>(base, { id: 'a', text: 'pc2' }, ctx('pc2', 200))
    const { items, conflicts } = mergeItems<Note>([onPc1], [onPc2])
    expect(items.get('a')?.text).toBe('pc1')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.discarded.text).toBe('pc2')
  })

  it("rispetta le lapidi e l'ordine dei file non conta", () => {
    const v1 = nextRevision<Note>(undefined, { id: 'a', text: 'x' }, ctx('pc1', 100))
    const del = tombstone(v1, ctx('pc2', 150))
    const a = mergeItems<Note>([v1], [del])
    const b = mergeItems<Note>([del], [v1])
    expect(a.items.get('a')?.deletedAt).toBe(150)
    expect(b.items.get('a')?.rev).toBe(a.items.get('a')?.rev)
    expect(a.conflicts).toHaveLength(0)
  })

  it("una modifica fatta dopo un'eliminazione concorrente vince", () => {
    const v1 = nextRevision<Note>(undefined, { id: 'a', text: 'x' }, ctx('pc1', 100))
    const del = tombstone(v1, ctx('pc2', 150))
    const edit = nextRevision<Note>(v1, { id: 'a', text: 'y' }, ctx('pc1', 160))
    const { items, conflicts } = mergeItems<Note>([del], [edit])
    expect(items.get('a')?.deletedAt).toBeNull()
    expect(items.get('a')?.text).toBe('y')
    expect(conflicts).toHaveLength(0)
  })

  it('a parità di orario sceglie in modo deterministico', () => {
    const a: SyncItem<Note> = { id: 'k', text: 'a', createdAt: 1, updatedAt: 5, updatedBy: 'pcA', rev: 'ra', hist: [] }
    const b: SyncItem<Note> = { ...a, text: 'b', updatedBy: 'pcB', rev: 'rb' }
    expect(mergeItems<Note>([a], [b]).items.get('k')?.text).toBe('b')
    expect(mergeItems<Note>([b], [a]).items.get('k')?.text).toBe('b')
  })

  it("una nuova revisione è sempre più recente anche se l'orologio locale è indietro", () => {
    const v1 = nextRevision<Note>(undefined, { id: 'a', text: 'x' }, ctx('pc1', 1000))
    const v2 = nextRevision<Note>(v1, { id: 'a', text: 'y' }, ctx('pc2', 500))
    expect(v2.updatedAt).toBeGreaterThan(v1.updatedAt)
    expect(v2.hist[0]).toBe(v1.rev)
  })
})
