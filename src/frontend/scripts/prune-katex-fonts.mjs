#!/usr/bin/env node
/**
 * Post-build step (`npm run build` runs it as part of `postbuild`).
 *
 * KaTeX's stylesheet lists every font three times (woff2, woff, ttf), and Vite
 * copies all 60 files (about 1.07 MB) into dist/assets, which ships in the
 * Python wheel. Every browser that can run this app supports woff2, so the
 * woff and ttf copies (about 0.8 MB) are dead weight.
 *
 * This script:
 *   1. rewrites each `@font-face { src: ... }` in dist/assets/*.css that has a
 *      woff2 source down to that woff2 source only;
 *   2. deletes the KaTeX woff/ttf files that nothing in dist references any more;
 *   3. removes those files from dist/aiui-manifest.json.
 *
 * Only fonts named KaTeX_* are touched. The stylesheet keeps its hashed file
 * name: the rewrite is a pure function of the build, so the same name always
 * has the same content.
 *
 * Usage: node scripts/prune-katex-fonts.mjs [--dist <dir>]
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const dist = path.resolve(ROOT, argValue('--dist') ?? 'dist')
const assets = path.join(dist, 'assets')
if (!existsSync(assets)) {
  console.error(`prune-katex-fonts: ${assets} not found; run \`vite build\` first`)
  process.exit(1)
}

const LEGACY_FONT = /^KaTeX_[\w-]+\.(?:woff|ttf)$/
// One `src:` value: a comma-separated list of url(...) format(...) sources.
const FONT_SRC = /src:((?:\s*url\([^)]*\)(?:\s*format\([^)]*\))?\s*,?)+)/g

const SOURCE = /url\([^)]*\)(?:\s*format\([^)]*\))?/g

/**
 * Keep only the woff2 sources of one `src:` value, when its other sources are
 * KaTeX woff/ttf files. (A small woff2 may be inlined as a data: URL, which
 * contains commas, so sources are matched, not split.)
 */
function woff2Only(srcValue) {
  const sources = srcValue.match(SOURCE) ?? []
  const isWoff2 = (s) => /format\(["']woff2["']\)/.test(s)
  const woff2 = sources.filter(isWoff2)
  const others = sources.filter((s) => !isWoff2(s))
  if (woff2.length === 0 || others.length === 0) return srcValue
  if (!others.every((s) => /url\([^)]*KaTeX_[\w-]+\.(?:woff|ttf)["']?\)/.test(s))) return srcValue
  return woff2.join(',')
}

let rewritten = 0
const names = readdirSync(assets)
for (const name of names.filter((n) => n.endsWith('.css'))) {
  const file = path.join(assets, name)
  const css = readFileSync(file, 'utf8')
  if (!css.includes('KaTeX_')) continue
  const next = css.replace(FONT_SRC, (_m, value) => `src:${woff2Only(value)}`)
  if (next !== css) {
    writeFileSync(file, next)
    rewritten++
  }
}

// A font is only deleted when no text file in dist still names it.
const texts = names
  .filter((n) => /\.(?:css|js|html)$/.test(n))
  .map((n) => readFileSync(path.join(assets, n), 'utf8'))
texts.push(readFileSync(path.join(dist, 'index.html'), 'utf8'))

const removed = []
let bytes = 0
for (const name of names.filter((n) => LEGACY_FONT.test(n))) {
  if (texts.some((t) => t.includes(name))) continue
  const file = path.join(assets, name)
  bytes += statSync(file).size
  rmSync(file)
  removed.push(`assets/${name}`)
}

const manifestFile = path.join(dist, 'aiui-manifest.json')
if (removed.length && existsSync(manifestFile)) {
  const gone = new Set(removed)
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  for (const [key, chunk] of Object.entries(manifest)) {
    if (gone.has(chunk.file)) {
      delete manifest[key]
      continue
    }
    if (Array.isArray(chunk.assets)) {
      chunk.assets = chunk.assets.filter((a) => !gone.has(a))
      if (chunk.assets.length === 0) delete chunk.assets
    }
  }
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
}

console.log(
  `prune-katex-fonts: ${rewritten} stylesheet(s) rewritten, ${removed.length} woff/ttf file(s) removed (${(bytes / 1024).toFixed(0)} KiB)`,
)
