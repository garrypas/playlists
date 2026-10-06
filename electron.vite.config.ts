import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Dev mode needs inline scripts (React refresh preamble), inline styles (Vite CSS injection)
// and a websocket for HMR. Production builds get none of those.
function contentSecurityPolicy(): Plugin {
  const shared = [
    "default-src 'self'",
    "img-src 'self' data: playlist-audio:",
    "font-src 'self' https://fonts.gstatic.com",
    "media-src 'self' playlist-audio:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ]
  const production = [
    ...shared,
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
  ]
  const development = [
    ...shared,
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "connect-src 'self' ws://localhost:* http://localhost:*",
  ]

  return {
    name: 'content-security-policy',
    transformIndexHtml(_html, context) {
      const policy = (context.server ? development : production).join('; ')
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }]
    },
  }
}

export default defineConfig({
  main: {
    // music-metadata is ESM-only, so it's bundled into the CommonJS main build rather than required at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ['music-metadata'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), contentSecurityPolicy()],
  },
})
