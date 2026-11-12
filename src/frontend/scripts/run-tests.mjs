#!/usr/bin/env node
/**
 * Frontend unit test runner: `npm test [-- <path-substring> ...]`.
 *
 * Finds every src/**\/*.test.{ts,tsx}, bundles each one with esbuild into
 * node_modules/.cache/aiui-tests/ and runs the bundles with `node --test`.
 * Bundling is required: Node's type stripping cannot resolve extensionless
 * imports (`./protocol`), the `@/` alias, TSX or CSS imports.
 *
 * - npm packages stay external (Node loads them from node_modules, so React
 *   has one copy and react-dom/server works).
 * - CSS imports (relative or from packages) become empty modules.
 * - `import.meta.env` is defined the way Vite would in a test build.
 * - Positional arguments filter test files by path substring.
 *
 * Exits 0 when no test file matches.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'aiui-tests')
const TEST_FILE = /\.test\.tsx?$/
const SKIP_DIRS = new Set(['node_modules', 'dist'])

function findTests(dir) {
  const found = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) found.push(...findTests(full))
    else if (TEST_FILE.test(name)) found.push(full)
  }
  return found
}

/** Any `*.css` import (including bare package paths) becomes an empty module. */
const ignoreCss = {
  name: 'aiui-ignore-css',
  setup(build) {
    build.onResolve({ filter: /\.css(\?.*)?$/ }, (args) => ({ path: args.path, namespace: 'aiui-empty-css' }))
    build.onLoad({ filter: /.*/, namespace: 'aiui-empty-css' }, () => ({ contents: '', loader: 'js' }))
  },
}

const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const tests = findTests(SRC)
  .filter((f) => filters.length === 0 || filters.some((s) => path.relative(ROOT, f).includes(s)))
  .sort()

if (tests.length === 0) {
  console.log(filters.length ? `No test files match: ${filters.join(', ')}` : 'No test files found under src/.')
  process.exit(0)
}

rmSync(OUT, { recursive: true, force: true })

try {
  await esbuild.build({
    entryPoints: tests,
    outdir: OUT,
    outbase: SRC,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    splitting: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    tsconfig: path.join(ROOT, 'tsconfig.app.json'),
    alias: { '@': SRC },
    loader: {
      '.css': 'empty',
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.gif': 'dataurl',
      '.webp': 'dataurl',
    },
    plugins: [ignoreCss],
    define: {
      'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true, SSR: true, BASE_URL: '/' }),
    },
    jsx: 'automatic',
    sourcemap: 'inline',
    logLevel: 'warning',
  })
} catch {
  // esbuild already printed the diagnostics.
  process.exit(1)
}

const bundles = tests.map((t) => {
  const rel = path.relative(SRC, t).replace(/\.tsx?$/, '.mjs')
  const out = path.join(OUT, rel)
  if (!existsSync(out)) {
    console.error(`run-tests: esbuild did not emit ${out}`)
    process.exit(1)
  }
  return out
})

console.log(`run-tests: ${tests.length} test file(s): ${tests.map((t) => path.relative(ROOT, t)).join(', ')}`)
const res = spawnSync(process.execPath, ['--enable-source-maps', '--test', ...bundles], {
  cwd: ROOT,
  stdio: 'inherit',
})
if (res.error) {
  console.error(res.error)
  process.exit(1)
}
process.exit(res.status ?? 1)
