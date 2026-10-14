import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { log } from '../log'

/**
 * Client dell'helper nativo PixNative.exe (C#/.NET), che fornisce le funzioni
 * Windows non raggiungibili da Electron (Windows Hello, DPAPI, appunti, stato
 * schermo intero). Protocollo: una riga JSON per richiesta e per risposta.
 * L'helper parte solo alla prima richiesta e si riavvia se cade.
 */

export interface NativeEvent {
  event: string
  [key: string]: unknown
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class PixNative {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private warnedMissing = false
  private eventListeners = new Set<(event: NativeEvent) => void>()

  constructor(private readonly exePath: string) {}

  get available(): boolean {
    return existsSync(this.exePath)
  }

  call<T = unknown>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
    if (!this.available) {
      if (!this.warnedMissing) {
        log.warn(`PixNative non trovato in ${this.exePath} (esegui "npm run native")`)
        this.warnedMissing = true
      }
      return Promise.reject(new Error('native-unavailable'))
    }
    const proc = this.ensure()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`native-timeout:${cmd}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
    })
  }

  /** Eventi spontanei dell'helper (es. cambi degli appunti). */
  onEvent(cb: (event: NativeEvent) => void): () => void {
    this.eventListeners.add(cb)
    return () => this.eventListeners.delete(cb)
  }

  dispose(): void {
    this.proc?.kill()
    this.proc = null
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const proc = spawn(this.exePath, [], { windowsHide: true, stdio: 'pipe' })
    this.proc = proc
    createInterface({ input: proc.stdout }).on('line', (line) => this.onLine(line))
    proc.stderr.on('data', (d: Buffer) => log.warn(`PixNative: ${d.toString().trim()}`))
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null
      for (const [, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new Error(`native-exit:${code}`))
      }
      this.pending.clear()
    })
    proc.on('error', (err) => log.error('PixNative non avviabile', err))
    return proc
  }

  private onLine(line: string): void {
    let msg: { id?: number; ok?: boolean; result?: unknown; error?: string; event?: string }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (typeof msg.event === 'string') {
      for (const cb of this.eventListeners) cb(msg as NativeEvent)
      return
    }
    if (typeof msg.id !== 'number') return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error ?? 'native-error'))
  }
}
