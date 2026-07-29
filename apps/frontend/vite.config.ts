import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { localApiPlugin } from './vite-plugin-local-api'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Node + PGlite for `/api` in local dev (before workerd).
    localApiPlugin(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart({
      srcDirectory: '.',
      router: {
        entry: 'src/router.tsx',
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
      },
      server: {
        entry: 'src/server.ts',
      },
    }),
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
