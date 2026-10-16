/**
 * Regista delle animazioni di Pix: una sola alla volta, mai sovrapposte.
 *
 * Ogni animazione chiede il "palco" con una priorità:
 * - quelle che fai tu (afferrarlo, inghiottire, eliminare, le prove) vincono su tutto;
 * - poi gli stati (pensa, festeggia) e le animazioni delle sezioni;
 * - per ultime quelle spontanee (meteo, sbadiglio, giochi del corpo).
 * Una più importante interrompe quella in corso; una meno importante (o pari
 * ma diversa) rinuncia e riproverà più tardi.
 */
export type Act =
  | 'grab'
  | 'swallow'
  | 'trash'
  | 'farewell'
  | 'preview'
  | 'mood'
  | 'section'
  | 'pop'
  | 'weather'
  /** Il meteo provato dalle impostazioni: parte subito, come le altre prove. */
  | 'weatherTry'
  | 'yawn'
  | 'spontaneous'
  | 'turn'

const PRIORITY: Record<Act, number> = {
  grab: 5,
  swallow: 4,
  trash: 4,
  farewell: 4,
  preview: 4,
  mood: 3,
  section: 2,
  pop: 2,
  weather: 1,
  weatherTry: 4,
  yawn: 1,
  spontaneous: 1,
  turn: 1
}

export class Director {
  private cur: { act: Act; until: number; token: number; timer: ReturnType<typeof setTimeout> } | null = null
  private seq = 0

  constructor(
    /** Il palco è cambiato (per mostrare o nascondere gli elementi legati alle animazioni). */
    private readonly onChange: (act: Act | null) => void,
    /** Un'animazione in corso viene interrotta da una più importante. */
    private readonly onInterrupt: (act: Act) => void
  ) {}

  get active(): Act | null {
    return this.cur && this.cur.until > performance.now() ? this.cur.act : null
  }

  /**
   * Chiede il palco per `ms` millisecondi. Restituisce un gettone da usare con
   * `release`, oppure null se in questo momento c'è un'animazione che ha la precedenza.
   */
  claim(act: Act, ms: number): number | null {
    const now = performance.now()
    const cur = this.cur && this.cur.until > now ? this.cur : null
    if (cur) {
      const mine = PRIORITY[act]
      const theirs = PRIORITY[cur.act]
      // La stessa animazione può ripartire (es. un'altra sezione); una diversa di pari livello aspetta.
      if (theirs > mine || (theirs === mine && cur.act !== act)) return null
      clearTimeout(cur.timer)
      if (cur.act !== act) this.onInterrupt(cur.act)
    }
    const token = ++this.seq
    const timer = setTimeout(() => this.release(token), ms)
    this.cur = { act, until: now + ms, token, timer }
    this.onChange(act)
    return token
  }

  /** Libera il palco (solo se è ancora di chi l'aveva chiesto). */
  release(token: number | null): void {
    if (token === null || !this.cur || this.cur.token !== token) return
    clearTimeout(this.cur.timer)
    this.cur = null
    this.onChange(null)
  }

  dispose(): void {
    if (this.cur) clearTimeout(this.cur.timer)
    this.cur = null
  }
}
