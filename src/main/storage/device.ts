import { hostname } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJson, writeJson } from './localJson'
import type { DeviceInfo } from './collection'

/** Identità stabile di questo PC, salvata solo in locale. */
export async function loadDevice(localDir: string): Promise<DeviceInfo> {
  const file = join(localDir, 'device.json')
  const stored = await readJson<Partial<DeviceInfo>>(file, {})
  if (typeof stored.id === 'string' && /^[a-z0-9-]{8,64}$/i.test(stored.id)) {
    return { id: stored.id, name: hostname() }
  }
  const device = { id: randomUUID(), name: hostname() }
  await writeJson(file, device)
  return device
}
