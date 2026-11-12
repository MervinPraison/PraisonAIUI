import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Dev server: proxy every server-owned path to a running `aiui` backend so
// `npm run dev` (and the dev/*.html harness pages) can talk to real APIs.
const DEV_BACKEND = process.env.AIUI_DEV_BACKEND || 'http://127.0.0.1:8000'
const PROXIED_PATHS = [
  '/api',
  '/run',
  '/cancel',
  '/starters',
  '/sessions',
  '/plugins',
  '/dashboard-plugins',
  '/_aiui',
  '/_plugins',
  '/custom.js',
]

// React, ReactDOM and the scheduler get one stable chunk shared by the shell,
// the legacy App path and every lazy route (size budgets glob for it).
const VENDOR_REACT = /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/

// No chunk may import the entry. The server loads it as
// /assets/index.js?v=<build>, and a chunk's `import "./index.js"` is a
// different module URL, so the entry (and main.tsx's mount) would run twice.
// Two things would otherwise create such an import:
//  - Vite's dynamic-import preload helper, emitted inside the entry by default
//    (moved to its own chunk below);
//  - a second import of the global stylesheet src/index.css (App.tsx has one),
//    which makes the importing chunk depend on the entry that owns the CSS.
const ENTRY_FILE = 'assets/index.js'
const PRELOAD_HELPER = 'vite/preload-helper'
const MAIN_TSX = path.resolve(__dirname, 'src/main.tsx')
const GLOBAL_CSS = path.resolve(__dirname, 'src/index.css')
const NOOP_CSS_ID = '\0aiui-global-css-already-loaded'

/**
 * src/index.css is the entry's stylesheet (main.tsx imports it, the server
 * links /assets/index.css). In a build, any other module's import of it is
 * redundant and is resolved to an empty module.
 */
function globalCssOnlyFromEntry(): Plugin {
  return {
    name: 'aiui-global-css-only-from-entry',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !/index\.css(\?.*)?$/.test(source)) return null
      if (importer.split('?')[0] === MAIN_TSX) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved && resolved.id.split('?')[0] === GLOBAL_CSS) return NOOP_CSS_ID
      return null
    },
    load(id) {
      return id === NOOP_CSS_ID ? '' : null
    },
  }
}

/** Fail the build if any chunk imports the entry (see above). */
function noEntryImports(): Plugin {
  return {
    name: 'aiui-no-entry-imports',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || chunk.fileName === ENTRY_FILE) continue
        if (chunk.imports.includes(ENTRY_FILE) || chunk.dynamicImports.includes(ENTRY_FILE)) {
          this.error(
            `${chunk.fileName} imports ${ENTRY_FILE}; the entry is loaded with ?v= so it would be evaluated twice. ` +
              'Do not export from or import main.tsx, and import src/index.css only from main.tsx.',
          )
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [globalCssOnlyFromEntry(), react(), tailwindcss(), noEntryImports()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // The chat WebSocket must be listed before the /api prefix rule.
      '/api/chat/ws': { target: DEV_BACKEND, ws: true, changeOrigin: true },
      ...Object.fromEntries(PROXIED_PATHS.map((p) => [p, { target: DEV_BACKEND, changeOrigin: true }])),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Vite manifest (not the PWA kind): maps source modules to emitted chunks.
    // Gates (closure check, size budgets) and the server resolve chunks with it.
    manifest: 'aiui-manifest.json',
    rollupOptions: {
      // Only the real app entry. dev/*.html harness pages are served by the dev
      // server but never built (and spike.html is a dev-only page too).
      input: path.resolve(__dirname, 'index.html'),
      output: {
        // The entry keeps a fixed name: the Python server references
        // /assets/index.js?v=<cache_bust> directly. Everything it loads lazily
        // is content-hashed (immutable caching, and no case-insensitive name
        // collisions such as shiki's markdown.js vs our Markdown.js on macOS).
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const names = assetInfo.names ?? []
          const origins = assetInfo.originalFileNames ?? []
          // The entry's CSS (index.html -> main.tsx -> index.css) is linked by
          // the server as /assets/index.css, so it keeps its fixed name. Any
          // other asset (lazy-chunk CSS, fonts, images) is hashed.
          if (names.includes('index.css') && origins.includes('index.html')) {
            return 'assets/index.css'
          }
          return 'assets/[name]-[hash][extname]'
        },
        manualChunks: (id) => {
          if (VENDOR_REACT.test(id)) return 'vendor-react'
          if (id.includes(PRELOAD_HELPER)) return 'preload-helper'
          return undefined
        },
      },
    },
  },
})
