import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { lucideIcons } from './scripts/lib/lucide-icons.mjs'
import { codeThemes } from './scripts/lib/code-themes.mjs'

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

// Selectable layouts (ADR 0003 R17). Every layout is its own chunk group
// `layout-<id>` (src/app-layouts/<id>/), the shared kit is `layout-kit`
// (src/app-layouts/kit/), and every layout-specific feature is `lf-<name>`
// (src/layout-features/<name>/). Rollup splits them naturally (each frame is
// a dynamic import); this only NAMES the chunks it made, in the file name and
// in aiui-manifest.json, which scripts/check-layout-isolation.mjs and the size
// budgets read. (manualChunks would pull shared dependencies into a layout
// chunk and make the shell import it.) A chunk that mixes two groups fails
// the build: some module imported another layout or feature statically.
const APP_LAYOUTS_DIR = path.resolve(__dirname, 'src/app-layouts') + path.sep
const LAYOUT_FEATURES_DIR = path.resolve(__dirname, 'src/layout-features') + path.sep
const GROUP_ID = /^[a-z][a-z0-9-]*$/

/** `layout-<id>`, `layout-kit` or `lf-<name>` for a module under those folders, else undefined. */
function layoutGroupOf(id: string): string | undefined {
  const file = path.normalize(id.split('?')[0])
  for (const [dir, prefix] of [
    [APP_LAYOUTS_DIR, 'layout-'],
    [LAYOUT_FEATURES_DIR, 'lf-'],
  ] as const) {
    if (!file.startsWith(dir)) continue
    const parts = file.slice(dir.length).split(path.sep)
    // Only modules inside a layout's (or feature's) folder; loose files there are tests.
    return parts.length > 1 && GROUP_ID.test(parts[0]) ? `${prefix}${parts[0]}` : undefined
  }
  return undefined
}

const KIT_GROUP = 'layout-kit'

/**
 * A chunk's group: its facade module's, else the one group its modules
 * belong to; `mixed` when it holds two layouts or features. Kit modules may
 * share a chunk with one group (with a single layout, Rollup merges the kit
 * into it).
 */
function layoutChunkName(chunk: { facadeModuleId: string | null; moduleIds: readonly string[] }): {
  name?: string
  mixed?: string[]
} {
  const groups = new Set(chunk.moduleIds.map(layoutGroupOf).filter((g): g is string => !!g))
  const owners = [...groups].filter((g) => g !== KIT_GROUP)
  if (owners.length > 1) return { mixed: owners.sort() }
  const facade = chunk.facadeModuleId ? layoutGroupOf(chunk.facadeModuleId) : undefined
  return { name: facade ?? owners[0] ?? (groups.size ? KIT_GROUP : undefined) }
}

function layoutChunkNames(): Plugin {
  return {
    name: 'aiui-layout-chunk-names',
    apply: 'build',
    generateBundle: {
      // Before vite:manifest writes the names into aiui-manifest.json.
      order: 'pre',
      handler(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue
          const { name, mixed } = layoutChunkName(chunk)
          if (mixed) {
            this.error(
              `${chunk.fileName} mixes ${mixed.join(' and ')}: a layout or layout feature is imported statically ` +
                'from outside its folder. Layouts never import each other; features load with import() (R17).',
            )
          }
          if (name) chunk.name = name
        }
      },
    },
  }
}

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
  plugins: [globalCssOnlyFromEntry(), react(), tailwindcss(), noEntryImports(), layoutChunkNames(), lucideIcons(__dirname), codeThemes()],
  // Chunks, their preloads and CSS url()s resolve relative to the file that
  // names them (import.meta.url), so one bundle works at the site root and
  // under a base path (`aiui build --base-path /repo`, src/lib/url.ts).
  // index.html keeps /assets/... (the compiler prefixes it).
  experimental: {
    renderBuiltUrl: (_file, { hostType }) => (hostType === 'html' ? undefined : { relative: true }),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // The chat WebSocket must be listed before the /api prefix rule.
      '/api/chat/ws': { target: DEV_BACKEND, ws: true, changeOrigin: true },
      // /api also carries WebSockets other than chat (logs stream and others).
      ...Object.fromEntries(
        PROXIED_PATHS.map((p) => [p, { target: DEV_BACKEND, changeOrigin: true, ws: p === '/api' }]),
      ),
      // GET /agents is the agent list the chat picker reads; /agents is also a
      // page route, so document navigations stay with the dev server.
      '/agents': {
        target: DEV_BACKEND,
        changeOrigin: true,
        bypass: (req) => (req.headers.accept?.includes('text/html') ? req.url : undefined),
      },
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
        chunkFileNames: (chunk) => `assets/${layoutChunkName(chunk).name ?? '[name]'}-[hash].js`,
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
