import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart(), tailwindcss(), viteReact()],
  build: process.env.INSPECTOR_OUT_DIR
    ? { emptyOutDir: true, outDir: process.env.INSPECTOR_OUT_DIR }
    : undefined,
  ssr: {
    external: [
      '@electric-sql/pglite',
      '@electric-sql/pglite/nodefs',
      '@electric-sql/pglite/opfs-ahp',
    ],
  },
})

export default config
