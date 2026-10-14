import { describe, expect, it } from 'vitest'
import { buildGroupTree, canMoveGroup, descendantsOf, effectiveParents, flattenTree, groupPath } from '@shared/vault'

const g = (id: string, parentId: string | null, order = 0) => ({ id, name: id.toUpperCase(), parentId, order, color: '#6366F1' })

describe('albero delle cartelle', () => {
  const groups = [g('clienti', null, 1), g('alfa', 'clienti', 2), g('db', 'alfa', 3), g('beta', 'clienti', 4), g('personale', null, 5)]

  it('costruisce l’albero e il percorso', () => {
    const flat = flattenTree(buildGroupTree(groups)).map((n) => `${'-'.repeat(n.depth)}${n.group.id}`)
    expect(flat).toEqual(['clienti', '-alfa', '--db', '-beta', 'personale'])
    expect(groupPath('db', groups)).toEqual(['CLIENTI', 'ALFA', 'DB'])
    expect([...descendantsOf('clienti', groups)].sort()).toEqual(['alfa', 'beta', 'clienti', 'db'])
  })

  it('non permette di spostare una cartella dentro sé stessa o una sua sottocartella', () => {
    expect(canMoveGroup('clienti', 'db', groups)).toBe(false)
    expect(canMoveGroup('clienti', 'clienti', groups)).toBe(false)
    expect(canMoveGroup('db', 'personale', groups)).toBe(true)
    expect(canMoveGroup('alfa', null, groups)).toBe(true)
  })

  it('un genitore eliminato su un altro PC porta la cartella al primo livello', () => {
    const p = effectiveParents([g('orfana', 'sparita', 1), g('x', 'orfana', 2)])
    expect(p.get('orfana')).toBeNull()
    expect(p.get('x')).toBe('orfana')
  })

  it('rompe i cicli creati da due PC sulla cartella più vecchia', () => {
    // pc1 ha messo A dentro B, pc2 ha messo B dentro A
    const cyc = [g('a', 'b', 1), g('b', 'a', 2), g('c', 'b', 3)]
    const p = effectiveParents(cyc)
    expect(p.get('a')).toBeNull()
    expect(p.get('b')).toBe('a')
    expect(p.get('c')).toBe('b')
    expect(flattenTree(buildGroupTree(cyc)).map((n) => n.group.id)).toEqual(['a', 'b', 'c'])
    expect(groupPath('c', cyc)).toEqual(['A', 'B', 'C'])
  })
})
