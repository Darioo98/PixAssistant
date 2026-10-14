import type { Codec } from '../storage/collection'
import { open, seal } from './crypto'

export class LockedError extends Error {
  constructor() {
    super('locked')
  }
}

/**
 * Codec che cifra l'intero file di una collezione con AES-256-GCM. I dati
 * associati (AAD) contengono il nome della collezione: un file non si può
 * scambiare con quello di un'altra collezione.
 *
 * - `allowPlainRead`: accetta file in chiaro scritti prima della configurazione
 *   delle chiavi (alla prossima scrittura diventano cifrati).
 * - `plainWriteWhenNoKey`: finché le chiavi non sono configurate si scrive in
 *   chiaro; dopo, senza chiave la scrittura fallisce invece di esporre i dati.
 */
export function encryptedCodec(opts: {
  key: () => Buffer | null
  aad: string
  allowPlainRead: boolean
  plainWriteWhenNoKey: () => boolean
}): Codec {
  return {
    encode(plain) {
      const key = opts.key()
      if (key) return JSON.stringify({ format: 'dock-encrypted', version: 1, ...seal(key, Buffer.from(plain, 'utf8'), opts.aad) })
      if (opts.plainWriteWhenNoKey()) return plain
      throw new LockedError()
    },
    decode(stored) {
      const parsed = JSON.parse(stored) as { format?: string; iv?: string; ct?: string }
      if (parsed.format === 'dock-encrypted') {
        const key = opts.key()
        if (!key) throw new LockedError()
        return open(key, { iv: String(parsed.iv), ct: String(parsed.ct) }, opts.aad).toString('utf8')
      }
      if (opts.allowPlainRead) return stored
      throw new LockedError()
    }
  }
}

/**
 * Codec per i dati sincronizzati non segreti (scadenze, note…): cifrati con la
 * sync key. Prima della configurazione delle chiavi restano in chiaro; dopo,
 * un PC non ancora collegato non può né leggerli né sovrascriverli.
 */
export function syncCodec(keys: { getSyncKey(): Buffer | null; setup: string }, collection: string): Codec {
  return encryptedCodec({
    key: () => keys.getSyncKey(),
    aad: `dock:${collection}`,
    allowPlainRead: true,
    plainWriteWhenNoKey: () => keys.setup === 'unconfigured'
  })
}
