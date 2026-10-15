import { describe, expect, it } from 'vitest'
import { analyzeVault, weakReason } from '@shared/vaultHealth'

describe('salute della cassaforte', () => {
  it('riconosce le password deboli', () => {
    expect(weakReason('password123')).toBe('common')
    expect(weakReason('Juventus2024!')).toBe('common')
    expect(weakReason('12345678')).toBe('pattern')
    expect(weakReason('qwertyui')).toBe('pattern')
    expect(weakReason('aaaaaaaaaaaa')).toBe('pattern')
    expect(weakReason('Gatto7!')).toBe('short')
    expect(weakReason('casacasacasa')).toBe('simple')
    expect(weakReason('t9#Vq2!mLx7@Rz')).toBeNull()
    expect(weakReason('')).toBeNull()
  })

  it('trova password ripetute e vecchie e calcola il punteggio', () => {
    const strong = 'k8$Lm2!pQz9@Wx'
    const h = analyzeVault(
      [
        { id: 'a', password: strong, lastChanged: '2026-10-01' },
        { id: 'b', password: strong, lastChanged: '2026-10-01' },
        { id: 'c', password: 'N7&vB3#qT1!eYw', lastChanged: '2025-01-10' },
        { id: 'd', password: 'R4@uH8$kP2!sJz', lastChanged: '2026-09-01' },
        { id: 'e', password: '', lastChanged: '2026-09-01' }
      ],
      '2026-10-14'
    )
    expect(h.checked).toBe(4)
    expect(h.issues.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(h.issues[0]).toMatchObject({ reusedWith: 1, weak: null, oldDays: null })
    expect(h.issues[2]!.oldDays).toBeGreaterThan(600)
    expect(h.score).toBe(25)
  })
})
