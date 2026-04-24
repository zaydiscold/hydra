import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const vitePort = Number(process.env.HYDRA_VITE_PORT) || 5173

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  server: {
    port: vitePort,
    strictPort: true,
    proxy: {
      // ─── ELECTRON_MIGRATION ───
      // TODO: PAIN_POINTS.md #6 — In Electron dev mode, Express runs on a random
      // free port (not 3001). This proxy target breaks. Fix: force Express to 3001
      // in electron/main.js dev mode, or inject apiBaseUrl via preload script.
      // ─── END ELECTRON_MIGRATION ───
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/v1': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
