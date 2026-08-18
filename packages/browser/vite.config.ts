import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import manifest from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    lib: {
      entry: {
        router: path.resolve(__dirname, './src/router.tsx'),
        react: path.resolve(__dirname, './src/react.tsx'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: 'style',
    },
    rollupOptions: {
      external: [...Object.keys(manifest.dependencies), 'react/jsx-runtime'],
    },
  },
})
