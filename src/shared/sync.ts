/**
 * Modello dei dati sincronizzabili e unione per singola voce.
 *
 * Ogni voce ha un `id` stabile e dei metadati di versione:
 * - `updatedAt`/`updatedBy`: chi l'ha modificata per ultimo (last-writer-wins);
 * - `rev` + `hist`: identificativo della revisione corrente e delle ultime revisioni
 *   precedenti. Servono a capire se due versioni diverse sono una l'antenata
 *   dell'altra (modifica normale) o modifiche concorrenti fatte su due PC
 *   (conflitto: la versione perdente non viene buttata, ma restituita al chiamante);
 * - `deletedAt`: lapide per le eliminazioni.
 */

export interface SyncMeta {
  id: string
  createdAt: number
  updatedAt: number
  updatedBy: string
  rev: string
  hist: string[]
  deletedAt?: number | null
}

export type SyncItem<T = unknown> = SyncMeta & T

/** Quante revisioni precedenti conservare in `hist`. */
export const HIST_LENGTH = 20

export interface MergeConflict<T> {
  id: string
  kept: SyncItem<T>
  discarded: SyncItem<T>
}

export interface MergeResult<T> {
  items: Map<string, SyncItem<T>>
  conflicts: MergeConflict<T>[]
}

/** Ordine totale e deterministico tra due versioni della stessa voce. */
export function pickNewer<T>(a: SyncItem<T>, b: SyncItem<T>): SyncItem<T> {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  const aDel = a.deletedAt != null
  const bDel = b.deletedAt != null
  if (aDel !== bDel) return aDel ? a : b
  if (a.updatedBy !== b.updatedBy) return a.updatedBy > b.updatedBy ? a : b
  return a.rev >= b.rev ? a : b
}

/** `true` se `older` compare nella storia di `newer` (quindi non è un conflitto). */
export function isAncestor<T>(older: SyncItem<T>, newer: SyncItem<T>): boolean {
  return older.rev === newer.rev || newer.hist.includes(older.rev)
}

/**
 * Unisce più elenchi di voci (es. i file di più PC). Il risultato contiene una
 * sola versione per `id`. Le versioni scartate che NON sono antenate di quella
 * vincente vengono segnalate in `conflicts`, così nulla si perde in silenzio.
 */
export function mergeItems<T>(...lists: ReadonlyArray<ReadonlyArray<SyncItem<T>>>): MergeResult<T> {
  const items = new Map<string, SyncItem<T>>()
  const losers = new Map<string, SyncItem<T>[]>()

  for (const list of lists) {
    for (const item of list) {
      const current = items.get(item.id)
      if (!current) {
        items.set(item.id, item)
        continue
      }
      if (current.rev === item.rev) continue
      const winner = pickNewer(current, item)
      const loser = winner === current ? item : current
      items.set(item.id, winner)
      const arr = losers.get(item.id) ?? []
      arr.push(loser)
      losers.set(item.id, arr)
    }
  }

  const conflicts: MergeConflict<T>[] = []
  for (const [id, arr] of losers) {
    const kept = items.get(id)!
    const seen = new Set<string>()
    for (const loser of arr) {
      if (seen.has(loser.rev) || isAncestor(loser, kept)) continue
      seen.add(loser.rev)
      // Una lapide che perde contro una modifica successiva non è un dato da salvare.
      if (loser.deletedAt != null) continue
      conflicts.push({ id, kept, discarded: loser })
    }
  }
  return { items, conflicts }
}

/** Nuova revisione di una voce (creazione o modifica). */
export function nextRevision<T>(
  prev: SyncItem<T> | undefined,
  data: T & { id: string },
  ctx: { deviceId: string; now: number; rev: string }
): SyncItem<T> {
  const hist = prev ? [prev.rev, ...prev.hist].slice(0, HIST_LENGTH) : []
  // L'orologio di un altro PC potrebbe essere avanti: la nuova versione deve
  // comunque risultare più recente di quella che sta sostituendo.
  const updatedAt = prev ? Math.max(ctx.now, prev.updatedAt + 1) : ctx.now
  return {
    ...data,
    createdAt: prev?.createdAt ?? ctx.now,
    updatedAt,
    updatedBy: ctx.deviceId,
    rev: ctx.rev,
    hist,
    deletedAt: null
  }
}

/** Lapide per l'eliminazione di una voce. */
export function tombstone<T>(prev: SyncItem<T>, ctx: { deviceId: string; now: number; rev: string }): SyncItem<T> {
  return {
    ...prev,
    updatedAt: Math.max(ctx.now, prev.updatedAt + 1),
    updatedBy: ctx.deviceId,
    rev: ctx.rev,
    hist: [prev.rev, ...prev.hist].slice(0, HIST_LENGTH),
    deletedAt: ctx.now
  }
}
