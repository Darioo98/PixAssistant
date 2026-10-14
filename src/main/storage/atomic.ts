import { open, rename, unlink, mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Prefisso dei file temporanei: chi legge le cartelle dati deve ignorarli. */
export const TEMP_PREFIX = '.~'

export function isTempName(name: string): boolean {
  return name.startsWith(TEMP_PREFIX)
}

/**
 * Scrittura atomica: file temporaneo nella stessa cartella, flush su disco,
 * poi rinomina sopra al file finale. Chi legge (noi o OneDrive) vede sempre
 * o la versione vecchia o quella nuova, mai un file a metà.
 * Se il file è bloccato per un attimo (antivirus, OneDrive) riprova.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `${TEMP_PREFIX}${basename(path)}.${randomBytes(4).toString('hex')}.tmp`)

  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (!RETRYABLE.has(code) || attempt >= 6) {
        await unlink(tmp).catch(() => undefined)
        throw err
      }
      await new Promise((r) => setTimeout(r, 40 * 2 ** attempt))
    }
  }
}
