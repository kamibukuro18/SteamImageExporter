import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const mobileHost = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: mobileHost ?? 'localhost',
    port: 5173,
    strictPort: true,
    hmr: mobileHost
      ? {
          protocol: 'ws',
          host: mobileHost,
          port: 5173,
        }
      : undefined,
  },
})
