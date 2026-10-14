import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic'

/** Piccolo file JSON locale (fuori da OneDrive), scritto in modo atomico. */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    // File rovinato: non lo sovrascriviamo alla cieca, ne teniamo una copia.
    await writeFileAtomic(`${path}.corrupt-${Date.now()}`, await readFile(path).catch(() => '')).catch(() => undefined)
    return fallback
  }
}

export function writeJson(path: string, value: unknown): Promise<void> {
  return writeFileAtomic(path, JSON.stringify(value, null, 2))
}
