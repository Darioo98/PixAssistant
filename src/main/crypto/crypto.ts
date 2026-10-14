import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

/**
 * Primitive crittografiche (solo processo main):
 * - AES-256-GCM con IV casuale da 96 bit e dati associati (AAD) che legano il
 *   testo cifrato al suo uso (es. "dock-keys:vault"), così un blocco non può
 *   essere spostato da un file all'altro;
 * - scrypt per ricavare una chiave dalla chiave di recupero;
 * - HKDF-SHA256 per ricavare una chiave dalla firma di Windows Hello.
 */

export interface Sealed {
  iv: string
  /** Testo cifrato + tag di autenticazione GCM, in base64. */
  ct: string
}

const IV_BYTES = 12
const TAG_BYTES = 16

export class WrongKeyError extends Error {
  constructor() {
    super('wrong-key')
  }
}

export function randomKey(): Buffer {
  return randomBytes(32)
}

export function seal(key: Buffer, plaintext: Buffer, aad: string): Sealed {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  return { iv: iv.toString('base64'), ct: ct.toString('base64') }
}

export function open(key: Buffer, sealed: Sealed, aad: string): Buffer {
  const iv = Buffer.from(sealed.iv, 'base64')
  const data = Buffer.from(sealed.ct, 'base64')
  if (iv.length !== IV_BYTES || data.length < TAG_BYTES) throw new WrongKeyError()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(data.subarray(data.length - TAG_BYTES))
  try {
    return Buffer.concat([decipher.update(data.subarray(0, data.length - TAG_BYTES)), decipher.final()])
  } catch {
    throw new WrongKeyError()
  }
}

export interface ScryptParams {
  N: number
  r: number
  p: number
  salt: string
}

export const DEFAULT_SCRYPT = { N: 2 ** 15, r: 8, p: 1 } as const

export function scryptKey(secret: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(
      secret,
      Buffer.from(params.salt, 'base64'),
      32,
      { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2 },
      (err, key) => (err ? reject(err) : resolve(key))
    )
  )
}

export function hkdfKey(material: Buffer, salt: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', material, salt, info, 32))
}

export function equalBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---- Chiave di recupero ----

/** Base32 di Crockford: niente I, L, O, U, così non si confondono lettere e numeri. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_BYTES = 20 // 160 bit → 32 caratteri

export function generateRecoveryKey(): string {
  return formatRecoveryKey(encodeBase32(randomBytes(RECOVERY_BYTES)))
}

/** "ABCD-EFGH-…": 8 gruppi da 4 caratteri. */
export function formatRecoveryKey(raw: string): string {
  return raw.match(/.{1,4}/g)!.join('-')
}

/**
 * Normalizza quello che l'utente digita: maiuscole, senza spazi o trattini,
 * e le lettere che si confondono (O → 0, I/L → 1). Restituisce i byte o null.
 */
export function parseRecoveryKey(input: string): Buffer | null {
  const clean = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (clean.length !== 32 || [...clean].some((c) => !ALPHABET.includes(c))) return null
  return decodeBase32(clean)
}

function encodeBase32(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function decodeBase32(s: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of s) {
    value = ((value << 5) | ALPHABET.indexOf(c)) & 0xffff
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}
