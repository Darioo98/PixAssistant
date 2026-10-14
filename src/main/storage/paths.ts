import { join } from 'node:path'
import type { DataDirInfo } from '@shared/ipc'

/** Nome della cartella dell'app dentro OneDrive. */
export const DATA_FOLDER = 'Dock'

/**
 * Cartella dati sincronizzata. Ordine di preferenza:
 * 1. cartella scelta a mano nelle impostazioni;
 * 2. OneDrive personale (`OneDriveConsumer`);
 * 3. OneDrive generico o aziendale (`OneDrive`, `OneDriveCommercial`);
 * 4. cartella locale (nessuna sincronizzazione).
 */
export function resolveDataDir(
  custom: string,
  env: Record<string, string | undefined>,
  localFallback: string
): DataDirInfo {
  if (custom.trim()) return { path: custom.trim(), kind: 'custom' }

  const consumer = env.OneDriveConsumer?.trim()
  const commercial = env.OneDriveCommercial?.trim()
  const generic = env.OneDrive?.trim()

  if (consumer) return { path: join(consumer, DATA_FOLDER), kind: 'personal' }
  if (generic) {
    const kind = commercial && samePath(generic, commercial) ? 'business' : 'personal'
    return { path: join(generic, DATA_FOLDER), kind }
  }
  if (commercial) return { path: join(commercial, DATA_FOLDER), kind: 'business' }
  return { path: join(localFallback, 'data'), kind: 'local' }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase()
  return norm(a) === norm(b)
}
