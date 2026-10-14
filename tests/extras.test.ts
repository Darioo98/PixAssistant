import { describe, expect, it } from 'vitest'
import { addClip, isExcludedApp, normalizeUrl, weatherKind, type ClipEntry } from '@shared/extras'

const clip = (id: string, text: string, pinned = false): ClipEntry => ({ id, kind: 'text', text, source: 'x.exe', at: 0, pinned })

describe('cronologia appunti', () => {
  it('aggiunge in cima e sposta i duplicati invece di ripeterli', () => {
    let list: ClipEntry[] = []
    list = addClip(list, clip('1', 'a'), 50).entries
    list = addClip(list, clip('2', 'b'), 50).entries
    list = addClip(list, clip('3', 'a'), 50).entries
    expect(list.map((e) => e.text)).toEqual(['a', 'b'])
  })

  it('rispetta il limite senza togliere le voci fissate', () => {
    let list: ClipEntry[] = [clip('p', 'fissata', true)]
    for (let i = 0; i < 5; i++) list = addClip(list, clip(String(i), `t${i}`), 3).entries
    expect(list.map((e) => e.text)).toEqual(['t4', 't3', 't2', 'fissata'])
    const r = addClip(list, clip('9', 'nuova'), 3)
    expect(r.removed.map((e) => e.text)).toEqual(['t2'])
  })

  it('riconosce le app escluse con o senza .exe', () => {
    expect(isExcludedApp('KeePass.exe', 'keepass, 1Password.exe')).toBe(true)
    expect(isExcludedApp('1password.exe', 'keepass; 1Password.exe')).toBe(true)
    expect(isExcludedApp('chrome.exe', 'keepass')).toBe(false)
    expect(isExcludedApp('', 'keepass')).toBe(false)
  })
})

describe('link e meteo', () => {
  it('accetta solo indirizzi web validi', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
    expect(normalizeUrl('http://intranet.local/x')).toBe('http://intranet.local/x')
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('file:///C:/Windows')).toBeNull()
    expect(normalizeUrl('ciao')).toBeNull()
  })

  it('traduce i codici meteo WMO', () => {
    expect(weatherKind(0)).toBe('clear')
    expect(weatherKind(2)).toBe('partly')
    expect(weatherKind(45)).toBe('fog')
    expect(weatherKind(63)).toBe('rain')
    expect(weatherKind(81)).toBe('showers')
    expect(weatherKind(73)).toBe('snow')
    expect(weatherKind(95)).toBe('storm')
  })
})
