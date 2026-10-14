import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { WrongKeyError, formatRecoveryKey, generateRecoveryKey, open, parseRecoveryKey, randomKey, seal } from '../src/main/crypto/crypto'
import { createKeys, newHelloChallenge, openKeys, openWithHello, sealWithHello } from '../src/main/crypto/keyring'
import { LockedError, encryptedCodec } from '../src/main/crypto/codec'
import {
  countdown,
  generatePassword,
  needsPasswordAlert,
  passwordStrength,
  withNewPassword,
  type VaultMeta,
  type VaultSecret
} from '@shared/vault'

describe('AES-256-GCM', () => {
  it('cifra e decifra; rifiuta chiave, dati associati o contenuto alterati', () => {
    const key = randomKey()
    const s = seal(key, Buffer.from('segreto'), 'aad')
    expect(open(key, s, 'aad').toString()).toBe('segreto')
    expect(() => open(randomKey(), s, 'aad')).toThrow(WrongKeyError)
    expect(() => open(key, s, 'altro')).toThrow(WrongKeyError)
    const tampered = Buffer.from(s.ct, 'base64')
    tampered[0]! ^= 1
    expect(() => open(key, { ...s, ct: tampered.toString('base64') }, 'aad')).toThrow(WrongKeyError)
  })

  it('usa un IV diverso a ogni cifratura', () => {
    const key = randomKey()
    expect(seal(key, Buffer.from('x'), 'a').iv).not.toBe(seal(key, Buffer.from('x'), 'a').iv)
  })
})

describe('chiave di recupero', () => {
  it('ha 8 gruppi da 4 caratteri e si rilegge in modo tollerante', () => {
    const rk = generateRecoveryKey()
    expect(rk).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    const bytes = parseRecoveryKey(rk)!
    expect(bytes).toHaveLength(20)
    expect(parseRecoveryKey(rk.toLowerCase().replace(/-/g, ' '))!.equals(bytes)).toBe(true)
  })

  it('confonde volutamente O/0 e I/L/1, rifiuta il resto', () => {
    const rk = formatRecoveryKey('0'.repeat(31) + '1')
    expect(parseRecoveryKey(rk.replace(/0/g, 'O').replace('1', 'l'))!.equals(parseRecoveryKey(rk)!)).toBe(true)
    expect(parseRecoveryKey('troppo-corta')).toBeNull()
    expect(parseRecoveryKey('U'.repeat(32))).toBeNull()
  })
})

describe('portachiavi', () => {
  it('un secondo PC apre le stesse chiavi con la chiave di recupero', async () => {
    const { file, keys, recoveryKey } = await createKeys()
    // il file su OneDrive non contiene le chiavi in chiaro
    const json = JSON.stringify(file)
    expect(json).not.toContain(keys.syncKey.toString('base64'))
    expect(json).not.toContain(keys.dataKey.toString('base64'))
    expect(json).not.toContain(recoveryKey)

    const other = await openKeys(JSON.parse(json), recoveryKey.toLowerCase())
    expect(other.syncKey.equals(keys.syncKey)).toBe(true)
    expect(other.dataKey.equals(keys.dataKey)).toBe(true)
  })

  it('rifiuta una chiave di recupero sbagliata', async () => {
    const { file } = await createKeys()
    await expect(openKeys(file, generateRecoveryKey())).rejects.toThrow(WrongKeyError)
  })

  it('Windows Hello: la stessa firma riapre la data key, un’altra no', () => {
    // Simula la chiave del TPM: RSA PKCS#1 v1.5 è deterministica come quella di Hello.
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const hello = (challenge: string) => sign('sha256', Buffer.from(challenge, 'base64'), privateKey).toString('base64')
    const dataKey = randomKey()
    const info = { credential: 'Dock.Vault', ...newHelloChallenge() }
    const file = sealWithHello(dataKey, hello(info.challenge), info)
    expect(JSON.stringify(file)).not.toContain(dataKey.toString('base64'))
    expect(openWithHello(file, hello(info.challenge)).equals(dataKey)).toBe(true)
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    const wrong = sign('sha256', Buffer.from(info.challenge, 'base64'), other).toString('base64')
    expect(() => openWithHello(file, wrong)).toThrow(WrongKeyError)
  })
})

describe('codec cifrato delle collezioni', () => {
  const plain = JSON.stringify({ format: 'dock-collection', items: [{ title: 'Bollo auto' }] })

  it('cifra il file intero e lo rilegge', async () => {
    const key = randomKey()
    const codec = encryptedCodec({ key: () => key, aad: 'dock:test', allowPlainRead: true, plainWriteWhenNoKey: () => false })
    const stored = await codec.encode(plain)
    expect(stored).not.toContain('Bollo')
    expect(await codec.decode(stored)).toBe(plain)
  })

  it('legge i vecchi file in chiaro e senza chiave non scrive in chiaro dopo la configurazione', async () => {
    let key: Buffer | null = null
    let configured = false
    const codec = encryptedCodec({ key: () => key, aad: 'dock:test', allowPlainRead: true, plainWriteWhenNoKey: () => !configured })
    expect(await codec.encode(plain)).toBe(plain)
    expect(await codec.decode(plain)).toBe(plain)
    configured = true
    expect(() => codec.encode(plain)).toThrow(LockedError)
    key = randomKey()
    const enc = await codec.encode(plain)
    key = null
    expect(() => codec.decode(enc)).toThrow(LockedError)
  })

  it('un file di una collezione non si apre come un’altra', async () => {
    const key = randomKey()
    const a = encryptedCodec({ key: () => key, aad: 'dock:a', allowPlainRead: false, plainWriteWhenNoKey: () => false })
    const b = encryptedCodec({ key: () => key, aad: 'dock:b', allowPlainRead: false, plainWriteWhenNoKey: () => false })
    expect(() => b.decode(a.encode(plain) as string)).toThrow(WrongKeyError)
  })
})

describe('cassaforte', () => {
  const meta: VaultMeta = { name: 'Gmail', intervalDays: 90, lastChanged: '2027-01-01', snoozedUntil: null }
  const secret: VaultSecret = { username: 'io', password: 'vecchia', url: '', notes: '', history: [] }

  it('calcola il countdown con i colori', () => {
    expect(countdown(meta, '2027-01-11', 7)).toMatchObject({ level: 'ok', daysLeft: 80, dueDate: '2027-04-01' })
    expect(countdown(meta, '2027-03-15', 7).level).toBe('warn') // ultimo 20%
    expect(countdown(meta, '2027-03-28', 3).level).toBe('warn') // dentro il preavviso
    expect(countdown(meta, '2027-04-01', 7).level).toBe('due')
    expect(countdown({ ...meta, intervalDays: 0 }, '2030-01-01', 7).level).toBe('never')
  })

  it('cambiare intervallo ricalcola la scadenza; reset riparte da oggi', () => {
    expect(countdown({ ...meta, intervalDays: 30 }, '2027-01-11', 7).dueDate).toBe('2027-01-31')
    expect(countdown({ ...meta, lastChanged: '2027-03-30' }, '2027-03-30', 7).daysLeft).toBe(90)
  })

  it('nuova password: storico delle ultime 5 e countdown azzerato', () => {
    let s = secret
    let m = meta
    for (let i = 1; i <= 7; i++) ({ secret: s, meta: m } = withNewPassword(s, m, `pw${i}`, i, '2027-02-01'))
    expect(s.password).toBe('pw7')
    expect(s.history.map((h) => h.password)).toEqual(['pw6', 'pw5', 'pw4', 'pw3', 'pw2'])
    expect(m.lastChanged).toBe('2027-02-01')
  })

  it('promemoria entro il preavviso, sospeso se posticipato', () => {
    expect(needsPasswordAlert(meta, '2027-03-29', 3)).toBe(true)
    expect(needsPasswordAlert(meta, '2027-03-20', 3)).toBe(false)
    expect(needsPasswordAlert({ ...meta, snoozedUntil: '2027-03-30' }, '2027-03-29', 3)).toBe(false)
  })

  it('genera password con tutte le classi e senza caratteri ambigui', () => {
    const rnd = (max: number) => createHash('sha256').update(String(Math.random())).digest().readUInt32BE(0) % max
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({ length: 16, symbols: true, avoidAmbiguous: true }, rnd)
      expect(pw).toHaveLength(16)
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/\d/)
      expect(pw).toMatch(/[^a-zA-Z\d]/)
      expect(pw).not.toMatch(/[Il1O0o|]/)
    }
    expect(generatePassword({ length: 12, symbols: false, avoidAmbiguous: false }, rnd)).toMatch(/^[a-zA-Z\d]{12}$/)
  })

  it('valuta la robustezza', () => {
    expect(passwordStrength('')).toBe(0)
    expect(passwordStrength('password123')).toBeLessThanOrEqual(1)
    expect(passwordStrength('aaaaaaaaaaaa')).toBe(0)
    expect(passwordStrength('k#8Tq!zP2@vLm9$w')).toBe(4)
  })
})
