import { z } from 'zod'

/** Versione scartata durante un conflitto (due PC hanno modificato la stessa voce). */
export interface ConflictView {
  id: string
  collection: string
  itemId: string
  title: string
  /** Quando è stato rilevato. */
  at: number
  /** Data della versione scartata e del PC che l'aveva scritta. */
  discardedAt: number
  discardedBy: string
  keptAt: number
}

export interface MaintenanceState {
  conflicts: ConflictView[]
  lastBackup: number | null
  backupsDir: string
  /** Il backup richiede le chiavi (cassaforte configurata). */
  canBackup: boolean
  /** Ultima sincronizzazione ricevuta da OneDrive. */
  lastSync: number | null
}

export const maintenanceOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('export') }),
  z.object({ op: z.literal('import'), recoveryKey: z.string().min(20).max(80) }),
  z.object({ op: z.literal('backupNow') }),
  z.object({ op: z.literal('openBackups') }),
  z.object({ op: z.literal('resolveConflict'), id: z.string().max(200), action: z.enum(['restore', 'dismiss']) }),
  z.object({ op: z.literal('changeDataDir') })
])
export type MaintenanceOp = z.infer<typeof maintenanceOpSchema>
export type MaintenanceResult = { ok: true; value?: string } | { ok: false; error: string }

/** Nome del backup giornaliero e rotazione (si tengono gli ultimi N). */
export function backupName(date: string): string {
  return `dock-${date}.dockbak`
}

export function backupsToDelete(names: string[], keep: number): string[] {
  const backups = names.filter((n) => /^dock-\d{4}-\d{2}-\d{2}\.dockbak$/.test(n)).sort()
  return backups.slice(0, Math.max(0, backups.length - keep))
}
