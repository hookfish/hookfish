import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
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
    nitro({
      // PGlite resolves its Postgres data bundle relative to its package at
      // runtime, so preserve the package instead of folding it into one chunk.
      traceDeps: ['@electric-sql/pglite*'],
    }),
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  ssr: {
    external: ['@electric-sql/pglite'],
  },
})
