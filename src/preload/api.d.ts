import type { PixApi } from '../shared/ipc'

declare global {
  interface Window {
    pix: PixApi
  }
}

export {}
