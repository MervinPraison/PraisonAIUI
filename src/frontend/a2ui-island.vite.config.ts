import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const dir = path.dirname(fileURLToPath(import.meta.url))

/** One canvas file. It is not part of /assets/index.js. */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(dir, 'src') },
  },
  publicDir: false,
  build: {
    outDir: 'dist-a2ui-island',
    emptyOutDir: true,
    minify: 'esbuild',
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(dir, 'src/surfaces/a2ui-island.tsx'),
      formats: ['es'],
      fileName: 'a2ui-island',
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'a2ui-island.js',
        assetFileNames: 'a2ui-island[extname]',
      },
    },
  },
})
