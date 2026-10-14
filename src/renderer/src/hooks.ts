import { useEffect, useState } from 'react'
import { toISODate, type ISODate } from '@shared/dates'
import type { DeadlineItem } from '@shared/deadlines'
import type { VaultEntryView } from '@shared/vault'

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
    const off = window.dock.deadlines.onChange((next) => alive && setItems(next))
    void window.dock.deadlines.list().then((next) => alive && setItems(next))
    return () => {
      alive = false
      off()
    }
  }, [])
  return items
}

/** Voci della cassaforte (senza password), allineate al processo main. */
export function useVaultEntries(): VaultEntryView[] | null {
  const [items, setItems] = useState<VaultEntryView[] | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.dock.vault.onChange((next) => alive && setItems(next))
    void window.dock.vault.list().then((next) => alive && setItems(next))
    return () => {
      alive = false
      off()
    }
  }, [])
  return items
}
