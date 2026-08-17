import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest.json'

export default defineConfig({
  plugins: [crx({ manifest })],
  server: {
    // Vite 6 tightened server.cors: it no longer reflects arbitrary origins back, and
    // CRXJS 2.3 doesn't re-add the extension origin. Without this, the dev-mode service
    // worker's `import 'http://localhost:5173/@crx/client-worker'` returns 200 with no
    // Access-Control-Allow-Origin and Chrome blocks it, so the worker never boots.
    //
    // Only affects `npm run dev` — a production build has no dev-server imports at all.
    cors: {
      origin: [/^chrome-extension:\/\//],
    },
  },
})
