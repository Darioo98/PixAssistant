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

/** Backup giornalieri o manuali: `pix-AAAA-MM-GG[-ms].pixbak` (o i vecchi `dock-….dockbak`). */
export const BACKUP_RE = /^(?:pix|dock)-(\d{4})-(\d{2})-(\d{2})(?:-\d+)?\.(?:pix|dock)bak$/
const DAILY_RE = /^(?:pix|dock)-\d{4}-\d{2}-\d{2}\.(?:pix|dock)bak$/

/** Nome del backup giornaliero e rotazione (si tengono gli ultimi N). */
export function backupName(date: string): string {
  return `pix-${date}.pixbak`
}

export function backupsToDelete(names: string[], keep: number): string[] {
  // Accetta anche i backup creati quando l'app si chiamava Dock.
  const backups = names.filter((n) => DAILY_RE.test(n)).sort((a, b) => a.slice(a.indexOf('-')).localeCompare(b.slice(b.indexOf('-'))))
  return backups.slice(0, Math.max(0, backups.length - keep))
}
