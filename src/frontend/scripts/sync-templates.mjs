#!/usr/bin/env node
/**
 * Copy the Vite build (dist/) into the Python package's frontend templates.
 *
 *   node scripts/sync-templates.mjs                 # -> src/praisonaiui/templates/frontend (tracked tree)
 *   node scripts/sync-templates.mjs --dest <dir>    # -> any directory, e.g. a temp dir
 *
 * Serve a --dest copy without touching the tracked tree:
 *   AIUI_TEMPLATES_DIR=<dir> aiui run ...
 *
 * Steps:
 *   1. delete <dest>/assets (removes stale hashed chunks from earlier builds)
 *   2. copy dist/assets/**, dist/index.html, dist/icon.svg,
 *      dist/aiui-manifest.json and dist/aiui-externals.json into <dest>
 * Anything else in <dest> (plugins/, dashboard-plugins/, chat.css, ...) is
 * left untouched.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const DEFAULT_DEST = path.resolve(ROOT, '..', 'praisonaiui', 'templates', 'frontend')
const ROOT_FILES = ['index.html', 'icon.svg', 'aiui-manifest.json', 'aiui-externals.json']

function fail(msg) {
  console.error(`sync-templates: ${msg}`)
  process.exit(1)
}

function parseDest(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dest') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('--dest needs a directory')
      return path.resolve(argv[i + 1])
    }
    if (a.startsWith('--dest=')) return path.resolve(a.slice('--dest='.length))
    if (a === '-h' || a === '--help') {
      console.log('usage: node scripts/sync-templates.mjs [--dest <dir>]')
      process.exit(0)
    }
    fail(`unknown argument: ${a}`)
  }
  return DEFAULT_DEST
}

const dest = parseDest(process.argv.slice(2))

// Guard against wiping something important with a typo'd --dest.
const forbidden = new Set([path.parse(dest).root, os.homedir(), ROOT, path.resolve(ROOT, '..'), DIST])
if (forbidden.has(dest)) fail(`refusing to sync into ${dest}`)

for (const required of ['index.html', 'assets/index.js', 'aiui-manifest.json']) {
  if (!existsSync(path.join(DIST, required))) fail(`dist/${required} is missing; run \`npm run build\` first`)
}
if (!existsSync(path.join(DIST, 'aiui-externals.json'))) {
  fail('dist/aiui-externals.json is missing; run `npm run build` (postbuild runs scripts/gen-externals.mjs)')
}
if (existsSync(dest) && !statSync(dest).isDirectory()) fail(`${dest} is not a directory`)

mkdirSync(dest, { recursive: true })
const destAssets = path.join(dest, 'assets')
rmSync(destAssets, { recursive: true, force: true })
cpSync(path.join(DIST, 'assets'), destAssets, { recursive: true })

const copied = []
for (const f of ROOT_FILES) {
  const src = path.join(DIST, f)
  if (!existsSync(src)) {
    console.warn(`sync-templates: dist/${f} not found, skipped`)
    continue
  }
  copyFileSync(src, path.join(dest, f))
  copied.push(f)
}

console.log(`sync-templates: dist/assets + ${copied.join(', ')} -> ${dest}`)
