import { diffDays, type ISODate } from './dates'

/**
 * Controllo salute della cassaforte, tutto in locale. Gira nel processo
 * principale (l'unico che vede le password): al pannello arrivano solo id e motivi.
 */
export type WeakReason = 'short' | 'common' | 'pattern' | 'simple'

export interface HealthIssue {
  id: string
  weak: WeakReason | null
  /** Quante altre voci usano la stessa password. */
  reusedWith: number
  /** Giorni dall'ultimo cambio, se la password è vecchia; altrimenti null. */
  oldDays: number | null
}

export interface VaultHealth {
  /** Voci con una password controllata. */
  checked: number
  issues: HealthIssue[]
  /** 0–100: percentuale di voci senza problemi. */
  score: number
}

/** Dopo quanti giorni una password si considera vecchia. */
export const OLD_AFTER_DAYS = 365

/** Password tra le più usate (in minuscolo, senza numeri finali). */
const COMMON = new Set([
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'azerty', 'asdfgh', 'zxcvbn', 'admin', 'administrator', 'welcome', 'benvenuto',
  'letmein', 'iloveyou', 'ciao', 'amore', 'monkey', 'dragon', 'football', 'calcio', 'juventus', 'inter', 'milan', 'napoli', 'roma',
  'sunshine', 'princess', 'abc', 'abcd', 'abcdef', 'test', 'prova', 'user', 'utente', 'login', 'changeme', 'secret', 'segreto', 'root'
])

/** Sequenze da tastiera o alfabetiche ("1234", "abcd", "qwer") o caratteri ripetuti ("aaaa"). */
function isPattern(pw: string): boolean {
  const s = pw.toLowerCase()
  if (/^(.)\1+$/.test(s)) return true
  const rows = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  for (const row of rows) {
    for (const r of [row, [...row].reverse().join('')]) {
      for (let len = s.length; len >= 4; len--) {
        // Quasi tutta la password è una sequenza.
        if (len >= s.length - 2 && r.includes(s.slice(0, len))) return true
      }
    }
  }
  return false
}

/** Stima della robustezza (bit), con penalità per ripetizioni. */
export function strengthBits(pw: string): number {
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/\d/.test(pw)) pool += 10
  if (/[^a-zA-Z\d]/.test(pw)) pool += 33
  const unique = new Set(pw).size
  const effectiveLength = Math.min(pw.length, unique * 2)
  return effectiveLength * Math.log2(Math.max(pool, 1))
}

export function weakReason(pw: string): WeakReason | null {
  if (!pw) return null
  const base = pw
    .toLowerCase()
    .replace(/[\d!?.@#$%&*_-]+$/, '')
    .replace(/^[\d]+/, '')
  if (COMMON.has(base) || COMMON.has(pw.toLowerCase())) return 'common'
  if (isPattern(pw)) return 'pattern'
  if (pw.length < 10) return 'short'
  if (strengthBits(pw) < 50) return 'simple'
  return null
}

export function analyzeVault(entries: Array<{ id: string; password: string; lastChanged: ISODate }>, today: ISODate): VaultHealth {
  const withPw = entries.filter((e) => e.password)
  const byPassword = new Map<string, number>()
  for (const e of withPw) byPassword.set(e.password, (byPassword.get(e.password) ?? 0) + 1)
  const issues: HealthIssue[] = []
  for (const e of withPw) {
    const age = diffDays(e.lastChanged, today)
    const issue: HealthIssue = {
      id: e.id,
      weak: weakReason(e.password),
      reusedWith: (byPassword.get(e.password) ?? 1) - 1,
      oldDays: age >= OLD_AFTER_DAYS ? age : null
    }
    if (issue.weak || issue.reusedWith > 0 || issue.oldDays !== null) issues.push(issue)
  }
  const checked = withPw.length
  return { checked, issues, score: checked ? Math.round(((checked - issues.length) / checked) * 100) : 100 }
}
