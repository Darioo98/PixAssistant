import { useEffect, useState } from 'react'
import { toISODate, type ISODate } from '@shared/dates'
import type { DeadlineItem } from '@shared/deadlines'
import type { VaultData, VaultEntryView } from '@shared/vault'
import type { DataCollection, DataItems } from '@shared/ipc'

/** Data di oggi, aggiornata da sola a mezzanotte. */
export function useToday(): ISODate {
  const [today, setToday] = useState(() => toISODate(new Date()))
  useEffect(() => {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
    const id = window.setTimeout(() => setToday(toISODate(new Date())), midnight.getTime() - now.getTime())
    return () => window.clearTimeout(id)
  }, [today])
  return today
}

/** Elenco delle scadenze, sempre allineato al processo main. */
export function useDeadlines(): DeadlineItem[] | null {
  const [items, setItems] = useState<DeadlineItem[] | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.pix.deadlines.onChange((next) => alive && setItems(next))
    void window.pix.deadlines.list().then((next) => alive && setItems(next))
    return () => {
      alive = false
      off()
    }
  }, [])
  return items
}

/** Voci e raccolte della cassaforte (senza password), allineate al processo main. */
export function useVaultData(): VaultData | null {
  const [data, setData] = useState<VaultData | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.pix.vault.onChange((next) => alive && setData(next))
    void window.pix.vault.list().then((next) => alive && setData(next))
    return () => {
      alive = false
      off()
    }
  }, [])
  return data
}

export function useVaultEntries(): VaultEntryView[] | null {
  return useVaultData()?.entries ?? null
}

/** Dati di una collezione semplice (note, to-do, promemoria, timer), allineati al processo main. */
export function useData<C extends DataCollection>(collection: C): DataItems[C] | null {
  const [items, setItems] = useState<DataItems[C] | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.pix.data.onChange(collection, (next) => alive && setItems(next))
    void window.pix.data.list(collection).then((next) => alive && setItems(next))
    return () => {
      alive = false
      off()
    }
  }, [collection])
  return items
}

/** Ora corrente che si aggiorna ogni secondo, solo finché `active` è vero. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}
