import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Log minimale su file locale. Non registrare MAI segreti (password, chiavi,
 * contenuto della cassaforte o degli appunti): solo eventi e messaggi d'errore.
 */
let file: string | null = null
const MAX_BYTES = 1024 * 1024

export function initLog(localDir: string): void {
  const dir = join(localDir, 'logs')
  mkdirSync(dir, { recursive: true })
  file = join(dir, 'dock.log')
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'dock.old.log'))
  } catch {
    // il file non esiste ancora
  }
}

function write(level: string, msg: string, err?: unknown): void {
  const detail = err instanceof Error ? ` ${err.name}: ${err.message}` : err != null ? ` ${String(err)}` : ''
  const line = `${new Date().toISOString()} ${level} ${msg}${detail}\n`
  if (level === 'ERROR') console.error(line.trimEnd())
  else console.log(line.trimEnd())
  if (!file) return
  try {
    appendFileSync(file, line)
  } catch {
    // il log non deve mai far cadere l'app
  }
}

export const log = {
  info: (msg: string) => write('INFO', msg),
  warn: (msg: string, err?: unknown) => write('WARN', msg, err),
  error: (msg: string, err?: unknown) => write('ERROR', msg, err)
}
