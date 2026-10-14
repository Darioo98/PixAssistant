import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import it_ from '../src/shared/locales/it.json'
import en from '../src/shared/locales/en.json'

/**
 * Ogni chiave usata con t('…') nel codice deve esistere in tutte le lingue
 * e portare a un testo (non a un gruppo di testi): altrimenti l'interfaccia
 * mostrerebbe un messaggio d'errore al posto della scritta.
 */

type Tree = { [k: string]: string | Tree }
const LOCALES: Record<string, Tree> = { it: it_ as Tree, en: en as Tree }
/** Chiavi lette volutamente come oggetto (returnObjects). */
const OBJECT_KEYS = new Set(['settings.keys'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

function usedKeys(): string[] {
  const keys = new Set<string>()
  const re = /\bt\(\s*(['"`])((?:(?!\1).)+)\1/g
  for (const file of sourceFiles(join(__dirname, '../src'))) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(re)) keys.add(m[2]!)
  }
  return [...keys].filter((k) => /^[a-zA-Z]/.test(k))
}

/** Tutti i percorsi del dizionario che corrispondono alla chiave (i `${…}` valgono come jolly). */
function resolve(tree: Tree, key: string): Array<string | Tree | undefined> {
  const parts = key.replace(/\$\{[^}]+\}/g, '${*}').split('.')
  let nodes: Array<string | Tree | undefined> = [tree]
  parts.forEach((part, i) => {
    const last = i === parts.length - 1
    nodes = nodes.flatMap((n) => {
      if (!n || typeof n === 'string') return [undefined]
      if (part.includes('${')) {
        const re = new RegExp(`^${part.replace(/\$\{[^}]+\}/g, '[^.]+')}$`)
        const matches = Object.keys(n).filter((k) => re.test(k.replace(/_(one|other|zero|few|many)$/, '')))
        return matches.length ? [...new Set(matches.map((k) => k.replace(/_(one|other|zero|few|many)$/, '')))].map((k) => leaf(n, k, last)) : [undefined]
      }
      return [leaf(n, part, last)]
    })
  })
  return nodes
}

/** Un'ultima parte può essere plurale: "chiave_one" / "chiave_other". */
function leaf(n: Tree, k: string, last: boolean): string | Tree | undefined {
  if (k in n) return n[k]
  if (last && typeof n[`${k}_other`] === 'string') return n[`${k}_other`]
  return undefined
}

describe('testi dell\'interfaccia', () => {
  const keys = usedKeys()

  it('trova le chiavi nel codice', () => {
    expect(keys.length).toBeGreaterThan(50)
  })

  for (const [lang, tree] of Object.entries(LOCALES)) {
    it(`ogni chiave esiste ed è un testo in "${lang}"`, () => {
      const problems = keys.flatMap((key) => {
        const found = resolve(tree, key)
        if (OBJECT_KEYS.has(key)) return found.every((v) => v && typeof v === 'object') ? [] : [`${key}: mancante`]
        return found.flatMap((v) => (v === undefined ? [`${key}: mancante`] : typeof v !== 'string' ? [`${key}: è un gruppo, non un testo`] : []))
      })
      expect(problems).toEqual([])
    })
  }

  it('italiano e inglese hanno le stesse chiavi', () => {
    const flat = (t: Tree, prefix = ''): string[] =>
      Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flat(v, `${prefix}${k}.`)))
    expect(flat(LOCALES.en!).sort()).toEqual(flat(LOCALES.it!).sort())
  })
})
