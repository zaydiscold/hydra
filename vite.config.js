import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const vitePort = Number(process.env.HYDRA_VITE_PORT) || 5173
const serverPort = Number(process.env.HYDRA_SERVER_PORT) || 3001

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  build: {
    // #84: Generate source maps in production without exposing sourceMappingURL
    // to clients.  Maps are written to dist/ for error-tracking tools but the
    // bundles themselves contain no reference to them.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // #96: Split vendor dependencies (React, ReactDOM, React Router) into a
        // separate chunk.  These libraries change rarely — isolating them lets
        // the browser cache them across Hydra version updates, reducing initial
        // JS parse time by ~200KB and speeding up cold starts after upgrades.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: vitePort,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
      '/v1': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
})
