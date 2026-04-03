import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const vitePort = Number(process.env.HYDRA_VITE_PORT) || 5173

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: vitePort,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
