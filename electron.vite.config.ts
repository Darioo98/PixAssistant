import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

/**
 * CSP restrittiva per il renderer. In sviluppo Vite ha bisogno dello script
 * inline di React Refresh e del websocket HMR; nella build no.
 */
function csp(): Plugin {
  const base = [
    "default-src 'none'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'"
  ]
  return {
    name: 'pix-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const dev = Boolean(ctx.server)
        const policy = [
          ...base,
          dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
          dev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'self'"
        ].join('; ')
        return html.replace('%PIX_CSP%', policy)
      }
    }
  }
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared } },
  renderer: { plugins: [react(), csp()], resolve: { alias: shared } }
})
