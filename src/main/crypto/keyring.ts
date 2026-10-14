import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { writeFileAtomic } from '../storage/atomic'
import {
  DEFAULT_SCRYPT,
  WrongKeyError,
  generateRecoveryKey,
  hkdfKey,
  open,
  parseRecoveryKey,
  randomKey,
  scryptKey,
  seal,
  type Sealed
} from './crypto'

/**
 * Schema delle chiavi
 * --------------------
 * - data key (32 byte casuali): cifra la cassaforte (password).
 * - sync key (32 byte casuali): cifra gli altri dati sincronizzati (scadenze,
 *   metadati delle password, note…), così si possono leggere anche a
 *   cassaforte chiusa e i promemoria funzionano sempre.
 *
 * Su OneDrive (keys.json) le due chiavi sono cifrate SOLO con una chiave
 * ricavata (scrypt) dalla chiave di recupero: nessuna chiave in chiaro, nessun
 * dato legato al singolo PC.
 *
 * Su questo PC (fuori da OneDrive):
 * - la sync key è protetta con DPAPI (safeStorage), così si apre da sola
 *   all'accesso a Windows;
 * - la data key è cifrata con una chiave ricavata (HKDF) dalla firma di
 *   Windows Hello su una sfida casuale. La chiave privata di Hello sta nel
 *   TPM e firma solo dopo volto/impronta/PIN: senza quella verifica la data
 *   key non si può ricostruire. Il tutto è poi protetto anche con DPAPI.
 */

const sealedSchema = z.object({ iv: z.string(), ct: z.string() })

export const keyFileSchema = z.object({
  format: z.literal('dock-keys'),
  version: z.literal(1),
  createdAt: z.number(),
  kdf: z.object({ alg: z.literal('scrypt'), N: z.number(), r: z.number(), p: z.number(), salt: z.string() }),
  sync: sealedSchema,
  vault: sealedSchema
})
export type KeyFile = z.infer<typeof keyFileSchema>

const AAD_SYNC = 'dock-keys:sync'
const AAD_VAULT = 'dock-keys:vault'

export interface Keys {
  syncKey: Buffer
  dataKey: Buffer
}

/** Crea chiavi nuove: restituisce il file da salvare e la chiave di recupero da mostrare una volta. */
export async function createKeys(now = Date.now()): Promise<{ file: KeyFile; keys: Keys; recoveryKey: string }> {
  const recoveryKey = generateRecoveryKey()
  const keys = { syncKey: randomKey(), dataKey: randomKey() }
  const kdf = { alg: 'scrypt' as const, ...DEFAULT_SCRYPT, salt: randomBytes(16).toString('base64') }
  const kek = await scryptKey(parseRecoveryKey(recoveryKey)!, kdf)
  const file: KeyFile = {
    format: 'dock-keys',
    version: 1,
    createdAt: now,
    kdf,
    sync: seal(kek, keys.syncKey, AAD_SYNC),
    vault: seal(kek, keys.dataKey, AAD_VAULT)
  }
  kek.fill(0)
  return { file, keys, recoveryKey }
}

/** Apre le chiavi con la chiave di recupero. Lancia WrongKeyError se non corrisponde. */
export async function openKeys(file: KeyFile, recoveryKey: string): Promise<Keys> {
  const secret = parseRecoveryKey(recoveryKey)
  if (!secret) throw new WrongKeyError()
  const kek = await scryptKey(secret, file.kdf)
  try {
    return { syncKey: open(kek, file.sync, AAD_SYNC), dataKey: open(kek, file.vault, AAD_VAULT) }
  } finally {
    kek.fill(0)
  }
}

export async function readKeyFile(path: string): Promise<KeyFile | null> {
  try {
    return keyFileSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export function writeKeyFile(path: string, file: KeyFile): Promise<void> {
  return writeFileAtomic(path, JSON.stringify(file, null, 2))
}

// ---- Protezione locale (solo su questo PC) ----

/** DPAPI tramite safeStorage di Electron; nei test si sostituisce con un finto protettore. */
export interface LocalProtector {
  protect(data: Buffer): Buffer
  unprotect(data: Buffer): Buffer
}

export const helloFileSchema = z.object({
  version: z.literal(1),
  credential: z.string(),
  challenge: z.string(),
  salt: z.string(),
  dataKey: sealedSchema
})
export type HelloFile = z.infer<typeof helloFileSchema>

const HELLO_INFO = 'dock-vault-hello-v1'
const AAD_HELLO = 'dock-hello:vault'

/** Prepara una nuova registrazione: sfida e sale casuali. */
export function newHelloChallenge(): { challenge: string; salt: string } {
  return { challenge: randomBytes(32).toString('base64'), salt: randomBytes(16).toString('base64') }
}

export function sealWithHello(
  dataKey: Buffer,
  signatureB64: string,
  info: { credential: string; challenge: string; salt: string }
): HelloFile {
  const kek = hkdfKey(Buffer.from(signatureB64, 'base64'), Buffer.from(info.salt, 'base64'), HELLO_INFO)
  try {
    return { version: 1, ...info, dataKey: seal(kek, dataKey, AAD_HELLO) }
  } finally {
    kek.fill(0)
  }
}

export function openWithHello(file: HelloFile, signatureB64: string): Buffer {
  const kek = hkdfKey(Buffer.from(signatureB64, 'base64'), Buffer.from(file.salt, 'base64'), HELLO_INFO)
  try {
    return open(kek, file.dataKey as Sealed, AAD_HELLO)
  } finally {
    kek.fill(0)
  }
}
