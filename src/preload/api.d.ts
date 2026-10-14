import type { DockApi } from '../shared/ipc'

declare global {
  interface Window {
    dock: DockApi
  }
}

export {}
