import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const browserSource = path.resolve(__dirname, '../../packages/browser/src')

export default defineConfig({
  publicDir: path.resolve(__dirname, '../../packages/browser/public'),
  resolve: {
    alias: {
      '@hookfish/browser/router': path.resolve(browserSource, 'router.tsx'),
      '@': browserSource,
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-router'],
  },
  plugins: [
    tanstackStart({
      srcDirectory: '../../packages/browser/src',
      router: {
        entry: '../../../apps/frontend/router',
        generatedRouteTree: '../../../apps/frontend/routeTree.gen.ts',
      },
      server: { entry: '../../../apps/frontend/server' },
    }),
    tailwindcss(),
    viteReact(),
  ],
  build: process.env.FRONTEND_OUT_DIR
    ? { emptyOutDir: true, outDir: process.env.FRONTEND_OUT_DIR }
    : undefined,
  server: { open: process.env.HOOKFISH_OPEN === 'true' },
})
