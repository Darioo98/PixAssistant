import { z } from 'zod'
import { addDays, diffDays, type ISODate } from './dates'
import { isoDate } from './deadlines'

/**
 * Cassaforte: le voci sono divise in due parti con lo stesso id.
 * - Metadati (nome, intervallo, ultimo cambio): cifrati con la sync key,
 *   leggibili anche a cassaforte chiusa per i promemoria. Nessun segreto.
 * - Segreti (utente, password, URL, note, storico): cifrati con la data key,
 *   leggibili solo a cassaforte aperta.
 */

export const vaultMetaSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Giorni tra un cambio e l'altro; 0 = mai. */
  intervalDays: z.number().int().min(0).max(3650),
  lastChanged: isoDate,
  snoozedUntil: isoDate.nullable(),
  /** Raccolta (progetto) a cui appartiene; null = senza raccolta. Assente nelle voci create prima delle raccolte. */
  groupId: z.string().max(200).nullable().optional()
})
export type VaultMeta = z.infer<typeof vaultMetaSchema>

export const vaultSecretSchema = z.object({
  username: z.string().max(500),
  password: z.string().max(1000),
  url: z.string().max(2000),
  notes: z.string().max(10_000),
  /** Ultime 5 password usate (le più recenti per prime). */
  history: z.array(z.object({ password: z.string().max(1000), changedAt: z.number() })).max(5)
})
export type VaultSecret = z.infer<typeof vaultSecretSchema>

export const INTERVAL_PRESETS = [0, 30, 60, 90, 180, 365] as const
export const HISTORY_SIZE = 5

export type CountdownLevel = 'never' | 'ok' | 'warn' | 'due'

export interface Countdown {
  level: CountdownLevel
  /** Giorni al prossimo cambio (negativi = in ritardo); null se l'intervallo è "mai". */
  daysLeft: number | null
  /** Quota di tempo rimasta, 0–1, per la barra colorata. */
  ratio: number
  dueDate: ISODate | null
}

/** Countdown al prossimo cambio: verde, giallo (ultimo 20% o dentro il preavviso), rosso (scaduto). */
export function countdown(meta: Pick<VaultMeta, 'intervalDays' | 'lastChanged'>, today: ISODate, lead: number): Countdown {
  if (meta.intervalDays <= 0) return { level: 'never', daysLeft: null, ratio: 1, dueDate: null }
  const dueDate = addDays(meta.lastChanged, meta.intervalDays)
  const daysLeft = diffDays(today, dueDate)
  const ratio = Math.max(0, Math.min(1, daysLeft / meta.intervalDays))
  const level: CountdownLevel = daysLeft <= 0 ? 'due' : daysLeft <= lead || ratio <= 0.2 ? 'warn' : 'ok'
  return { level, daysLeft, ratio, dueDate }
}

export function needsPasswordAlert(meta: VaultMeta, today: ISODate, lead: number): boolean {
  const c = countdown(meta, today, lead)
  if (c.daysLeft === null || c.daysLeft > lead) return false
  return !(meta.snoozedUntil && diffDays(today, meta.snoozedUntil) > 0)
}

/** Nuova password: la vecchia va nello storico e il countdown riparte da oggi. */
export function withNewPassword(
  secret: VaultSecret,
  meta: VaultMeta,
  password: string,
  now: number,
  today: ISODate
): { secret: VaultSecret; meta: VaultMeta } {
  if (password === secret.password) return { secret, meta }
  const history = secret.password
    ? [{ password: secret.password, changedAt: now }, ...secret.history].slice(0, HISTORY_SIZE)
    : secret.history
  return { secret: { ...secret, password, history }, meta: { ...meta, lastChanged: today, snoozedUntil: null } }
}

// ---- Generatore ----

export const generatorOptionsSchema = z.object({
  length: z.number().int().min(8).max(128),
  symbols: z.boolean(),
  avoidAmbiguous: z.boolean()
})
export type GeneratorOptions = z.infer<typeof generatorOptionsSchema>

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!#$%&*+-=?@^_~.,:;'
const AMBIGUOUS = /[Il1O0o|`'"]/g

/**
 * Genera una password con un generatore casuale crittografico (`randomInt`).
 * Contiene almeno un carattere per ogni classe scelta.
 */
export function generatePassword(opts: GeneratorOptions, randomInt: (max: number) => number): string {
  const strip = (s: string) => (opts.avoidAmbiguous ? s.replace(AMBIGUOUS, '') : s)
  const classes = [LOWER, UPPER, DIGITS, ...(opts.symbols ? [SYMBOLS] : [])].map(strip)
  const all = classes.join('')
  const chars = classes.map((c) => c[randomInt(c.length)]!)
  while (chars.length < opts.length) chars.push(all[randomInt(all.length)]!)
  // Mescolamento Fisher–Yates, così i caratteri obbligatori non stanno all'inizio.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}

/** Robustezza 0–4 da una stima dell'entropia, penalizzando ripetizioni e sequenze. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/\d/.test(pw)) pool += 10
  if (/[^a-zA-Z\d]/.test(pw)) pool += 20
  const unique = new Set(pw).size
  const effectiveLength = Math.min(pw.length, unique * 2)
  let bits = effectiveLength * Math.log2(Math.max(pool, 2))
  if (/(.)\1{2,}/.test(pw)) bits -= 10
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|password|123456)/i.test(pw)) bits -= 20
  if (bits < 28) return 0
  if (bits < 40) return 1
  if (bits < 60) return 2
  if (bits < 80) return 3
  return 4
}

// ---- Vista per il renderer (mai password in chiaro) ----

/**
 * Cartella di password (categoria, sottocategoria…). Cifrata con la sync key
 * come i metadati. `parentId` null = primo livello.
 */
export const vaultGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  order: z.number(),
  /** Cartella che la contiene; assente nelle raccolte create prima delle sottocartelle. */
  parentId: z.string().max(200).nullable().optional()
})
export type VaultGroup = z.infer<typeof vaultGroupSchema>

export interface VaultGroupView extends VaultGroup {
  id: string
}

/** Colori proposti per le raccolte. */
export const GROUP_COLORS = ['#6366F1', '#0EA5E9', '#22B07D', '#F59E0B', '#F97362', '#EC4899', '#8B5CF6', '#64748B'] as const

export interface VaultData {
  entries: VaultEntryView[]
  groups: VaultGroupView[]
}

/** Cartella effettiva di una voce: quelle eliminate (anche da un altro PC) valgono come "primo livello". */
export function effectiveGroup(groupId: string | null | undefined, groups: readonly { id: string }[]): string | null {
  return groupId && groups.some((g) => g.id === groupId) ? groupId : null
}

// ---- Albero delle cartelle ----

type GroupLike = { id: string; parentId?: string | null; order: number; name: string }

/**
 * Genitore effettivo di ogni cartella. Un genitore inesistente (eliminato su
 * un altro PC) porta la cartella al primo livello. Un ciclo (due PC che
 * spostano cartelle una dentro l'altra) si rompe sulla cartella più vecchia,
 * che torna al primo livello: l'albero resta sempre valido.
 */
export function effectiveParents(groups: readonly GroupLike[]): Map<string, string | null> {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const parents = new Map<string, string | null>(
    groups.map((g) => [g.id, g.parentId && g.parentId !== g.id && byId.has(g.parentId) ? g.parentId : null])
  )
  const older = (a: string, b: string) => byId.get(a)!.order - byId.get(b)!.order || a.localeCompare(b)
  for (const g of groups) {
    const path: string[] = []
    const index = new Map<string, number>()
    let cur: string | null = g.id
    while (cur && !index.has(cur)) {
      index.set(cur, path.length)
      path.push(cur)
      cur = parents.get(cur) ?? null
    }
    if (cur) {
      const cycle = path.slice(index.get(cur)!).sort(older)
      parents.set(cycle[0]!, null)
    }
  }
  return parents
}

export interface GroupNode<G extends GroupLike = GroupLike> {
  group: G
  depth: number
  children: GroupNode<G>[]
}

/** Albero ordinato (per ordine e nome) a partire dai genitori effettivi. */
export function buildGroupTree<G extends GroupLike>(groups: readonly G[]): GroupNode<G>[] {
  const parents = effectiveParents(groups)
  const sort = (list: G[]) => list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  const build = (parent: string | null, depth: number): GroupNode<G>[] =>
    sort(groups.filter((g) => (parents.get(g.id) ?? null) === parent)).map((g) => ({ group: g, depth, children: build(g.id, depth + 1) }))
  return build(null, 0)
}

/** Albero "appiattito" in ordine di visita, con la profondità (per menu e selettori). */
export function flattenTree<G extends GroupLike>(nodes: GroupNode<G>[]): Array<{ group: G; depth: number }> {
  return nodes.flatMap((n) => [{ group: n.group, depth: n.depth }, ...flattenTree(n.children)])
}

/** La cartella e tutte quelle che contiene (a qualsiasi livello). */
export function descendantsOf(id: string, groups: readonly GroupLike[]): Set<string> {
  const parents = effectiveParents(groups)
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const [child, parent] of parents) {
      if (parent && out.has(parent) && !out.has(child)) {
        out.add(child)
        grew = true
      }
    }
  }
  return out
}

/** Percorso dalla radice alla cartella (nomi), es. ["Clienti", "Alfa"]. */
export function groupPath(id: string | null, groups: readonly GroupLike[]): string[] {
  if (!id) return []
  const parents = effectiveParents(groups)
  const byId = new Map(groups.map((g) => [g.id, g]))
  const path: string[] = []
  let cur: string | null = byId.has(id) ? id : null
  while (cur) {
    path.unshift(byId.get(cur)!.name)
    cur = parents.get(cur) ?? null
  }
  return path
}

/** Spostare `id` dentro `parent` è possibile solo se `parent` non sta già dentro `id`. */
export function canMoveGroup(id: string, parent: string | null, groups: readonly GroupLike[]): boolean {
  return parent === null || !descendantsOf(id, groups).has(parent)
}

export interface VaultEntryView {
  id: string
  name: string
  groupId: string | null
  intervalDays: number
  lastChanged: ISODate
  snoozedUntil: ISODate | null
  /** Presenti solo a cassaforte aperta. */
  username?: string
  url?: string
  notes?: string
  hasPassword?: boolean
  historyCount?: number
}

export interface VaultStatus {
  setup: 'unconfigured' | 'needsRecovery' | 'ready'
  unlocked: boolean
  unlockedUntil: number | null
  helloAvailable: boolean
  helloEnrolled: boolean
  /** La copia protetta richiede l'helper nativo. */
  secureClipboard: boolean
  /** Chiave di recupero appena creata, non ancora confermata dall'utente. */
  recoveryPending: boolean
}

export const vaultEntryInputSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  name: vaultMetaSchema.shape.name,
  username: vaultSecretSchema.shape.username,
  /** undefined = password invariata */
  password: vaultSecretSchema.shape.password.optional(),
  url: vaultSecretSchema.shape.url,
  notes: vaultSecretSchema.shape.notes,
  intervalDays: vaultMetaSchema.shape.intervalDays,
  groupId: z.string().max(200).nullable()
})
export type VaultEntryInput = z.infer<typeof vaultEntryInputSchema>

const id = z.string().min(1).max(200)
const recoveryKey = z.string().min(20).max(80)

export const vaultOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setup') }),
  z.object({ op: z.literal('pendingRecovery') }),
  z.object({ op: z.literal('ackRecovery') }),
  z.object({ op: z.literal('copyRecovery') }),
  z.object({ op: z.literal('link'), recoveryKey }),
  z.object({ op: z.literal('unlockRecovery'), recoveryKey }),
  z.object({ op: z.literal('unlockHello') }),
  z.object({ op: z.literal('enrollHello') }),
  z.object({ op: z.literal('removeHello') }),
  z.object({ op: z.literal('lock') }),
  z.object({ op: z.literal('save'), input: vaultEntryInputSchema }),
  z.object({ op: z.literal('remove'), id }),
  z.object({ op: z.literal('resetCountdown'), id }),
  z.object({ op: z.literal('setInterval'), id, intervalDays: vaultMetaSchema.shape.intervalDays }),
  z.object({ op: z.literal('newPassword'), id, options: generatorOptionsSchema }),
  z.object({ op: z.literal('generate'), options: generatorOptionsSchema }),
  z.object({ op: z.literal('copy'), id, field: z.enum(['username', 'password']) }),
  z.object({ op: z.literal('copyText'), text: z.string().max(1000) }),
  z.object({ op: z.literal('reveal'), id }),
  z.object({ op: z.literal('openUrl'), id }),
  z.object({ op: z.literal('snooze'), id, until: isoDate }),
  z.object({ op: z.literal('move'), id, groupId: id.nullable() }),
  z.object({
    op: z.literal('groupSave'),
    id: id.optional(),
    name: vaultGroupSchema.shape.name,
    color: vaultGroupSchema.shape.color,
    /** Solo per le nuove cartelle: dove crearla (null = primo livello). */
    parentId: id.nullable().optional()
  }),
  z.object({ op: z.literal('groupMove'), id, parentId: id.nullable() }),
  z.object({ op: z.literal('groupRemove'), id })
])
export type VaultOp = z.infer<typeof vaultOpSchema>

export type VaultOpResult = { ok: true; value?: string } | { ok: false; error: string }
