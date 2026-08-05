import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const backendUrl =
  process.env.HOOKFISH_BACKEND_URL ??
  `http://127.0.0.1:${process.env.HOOKFISH_BACKEND_PORT ?? '8787'}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    open: process.env.HOOKFISH_OPEN === 'true',
    strictPort: true,
    proxy: {
      '/api': backendUrl,
    },
  },
})
