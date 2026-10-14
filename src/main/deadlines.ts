import { join } from 'node:path'
import { CollectionStore, type DeviceInfo } from './storage/collection'
import {
  deadlineSchema,
  fromInput,
  markDone,
  reopen,
  snooze,
  type Deadline,
  type DeadlineInput,
  type DeadlineItem,
  type DeadlineOp
} from '@shared/deadlines'
import type { ISODate } from '@shared/dates'

/** Scadenze salvate nella cartella sincronizzata. */
export class DeadlineService {
  readonly store: CollectionStore<Deadline>

  constructor(
    dataDir: string,
    device: DeviceInfo,
    onError: (err: unknown, file?: string) => void,
    private readonly onDone: () => void
  ) {
    this.store = new CollectionStore<Deadline>({
      dir: join(dataDir, 'deadlines'),
      name: 'deadlines',
      device,
      schema: deadlineSchema,
      onError
    })
  }

  load(): Promise<void> {
    return this.store.load()
  }

  list(): DeadlineItem[] {
    return this.store.list()
  }

  save(input: DeadlineInput): DeadlineItem {
    const prev = input.id ? this.store.get(input.id) : undefined
    return this.store.put({ ...fromInput(input, prev), id: input.id })
  }

  remove(id: string): boolean {
    return this.store.remove(id)
  }

  done(id: string): boolean {
    return this.update(id, (d) => markDone(d, Date.now()), true)
  }

  reopen(id: string): boolean {
    return this.update(id, reopen)
  }

  snooze(id: string, until: ISODate): boolean {
    return this.update(id, (d) => snooze(d, until))
  }

  apply(op: DeadlineOp): boolean {
    switch (op.op) {
      case 'save':
        this.save(op.input)
        return true
      case 'remove':
        return this.remove(op.id)
      case 'done':
        return this.done(op.id)
      case 'reopen':
        return this.reopen(op.id)
      case 'snooze':
        return this.snooze(op.id, op.until)
    }
  }

  onChange(cb: () => void): () => void {
    return this.store.onChange(cb)
  }

  flush(): Promise<void> {
    return this.store.flush()
  }

  private update(id: string, fn: (d: Deadline) => Deadline, celebrate = false): boolean {
    const item = this.store.get(id)
    if (!item) return false
    this.store.put({ ...fn(item), id })
    if (celebrate) this.onDone()
    return true
  }
}
