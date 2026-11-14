#!/usr/bin/env node
/**
 * Gate: the bundle committed in the Python package is the bundle this source builds.
 *
 *   npm run build && node scripts/check-bundle-sync.mjs      (npm run check:bundle)
 *   node scripts/check-bundle-sync.mjs --against <dir>       compare with another copy
 *
 * Compares dist/ with src/praisonaiui/templates/frontend/ (or --against):
 * the file set and sha256 of index.html, icon.svg, aiui-manifest.json,
 * aiui-externals.json and everything under assets/. Lists files that are
 * missing from the copy, extra in the copy (stale chunks) or different, and
 * exits 1 on any difference. Other files in the copy (plugins/, chat.css, ...)
 * are hand-written and not compared.
 *
 * Chunk names carry content hashes, so the comparison is only meaningful with
 * the Node version in .nvmrc and dependencies installed by `npm ci`.
 *
 * To fix a failure: `npm run build && npm run sync`, then commit
 * src/praisonaiui/templates/frontend.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_COPY = path.resolve(ROOT, '..', 'praisonaiui', 'templates', 'frontend')
const ROOT_FILES = ['index.html', 'icon.svg', 'aiui-manifest.json', 'aiui-externals.json']

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  const value = process.argv[i + 1]
  if (!value || value.startsWith('--')) {
    console.error(`check-bundle-sync: ${flag} needs a directory`)
    process.exit(2)
  }
  return value
}

const dist = path.resolve(ROOT, argValue('--dist') ?? 'dist')
const copy = path.resolve(argValue('--against') ?? DEFAULT_COPY)

function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

/** Relative path -> sha256 for the compared part of a bundle directory. */
function fingerprint(dir) {
  const files = new Map()
  for (const name of ROOT_FILES) {
    if (existsSync(path.join(dir, name))) files.set(name, null)
  }
  const assets = path.join(dir, 'assets')
  if (existsSync(assets)) for (const rel of walk(assets)) files.set(`assets/${rel}`, null)
  for (const rel of files.keys()) {
    files.set(rel, createHash('sha256').update(readFileSync(path.join(dir, rel))).digest('hex'))
  }
  return files
}

for (const required of ['index.html', 'assets/index.js', 'aiui-manifest.json', 'aiui-externals.json']) {
  if (!existsSync(path.join(dist, required))) {
    console.error(`check-bundle-sync: ${path.relative(process.cwd(), path.join(dist, required))} is missing; run \`npm run build\` first`)
    process.exit(2)
  }
}
if (!existsSync(copy)) {
  console.error(`check-bundle-sync: ${copy} does not exist`)
  process.exit(2)
}

const built = fingerprint(dist)
const committed = fingerprint(copy)
const missing = [...built.keys()].filter((f) => !committed.has(f))
const extra = [...committed.keys()].filter((f) => !built.has(f))
const changed = [...built.keys()].filter((f) => committed.has(f) && committed.get(f) !== built.get(f))

const where = path.relative(process.cwd(), copy) || copy
if (missing.length + extra.length + changed.length === 0) {
  console.log(`check-bundle-sync: OK (${built.size} files match ${where})`)
  process.exit(0)
}

const LIMIT = 20
function report(title, files) {
  if (files.length === 0) return
  console.error(`  ${title} (${files.length}):`)
  for (const f of files.slice(0, LIMIT)) console.error(`    ${f}`)
  if (files.length > LIMIT) console.error(`    ... and ${files.length - LIMIT} more`)
}
console.error(`check-bundle-sync: FAILED: ${where} is not the bundle this source builds`)
report('missing from the copy', missing)
report('stale in the copy (not in this build)', extra)
report('different content', changed)
console.error('Fix: npm run build && npm run sync, then commit src/praisonaiui/templates/frontend')
process.exit(1)
