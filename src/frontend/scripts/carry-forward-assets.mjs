#!/usr/bin/env node
/**
 * Keep the previous deploy's chunks alive for one more release of a static site.
 *
 *   node scripts/carry-forward-assets.mjs <previous-site-dir> <new-site-dir>
 *
 * A static deploy replaces every file. A reader who still has the previous
 * page open (or cached) then asks for chunks that no longer exist, and lazy
 * parts of the page (code highlighting, diagrams, math) fail until they
 * reload. This copies the previous build's assets into the new site, next to
 * the new ones, so both generations work.
 *
 * Which files are carried:
 *   - previous site has aiui-manifest.json (written by `aiui build`): exactly
 *     the files that manifest lists, i.e. the previous build's own files. What
 *     the previous deploy had carried from the one before is dropped, so a
 *     file lives for one extra release and the site does not grow for ever.
 *   - no manifest (a site built before chunks were hashed): every file in its
 *     assets/ directory.
 * A file that also exists in the new build is never overwritten.
 *
 * Exits 0 when there is no previous site (first deploy).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MANIFEST = 'aiui-manifest.json'

/** assets/-relative paths of the files the previous build owns. */
export function previousAssets(prevDir) {
  const assetsDir = path.join(prevDir, 'assets')
  if (!existsSync(assetsDir)) return []
  const manifestFile = path.join(prevDir, MANIFEST)
  if (existsSync(manifestFile)) {
    const files = new Set()
    for (const chunk of Object.values(JSON.parse(readFileSync(manifestFile, 'utf8')))) {
      for (const f of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
        if (typeof f === 'string' && f.startsWith('assets/')) files.add(f.slice('assets/'.length))
      }
    }
    return [...files].sort()
  }
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : [path.relative(assetsDir, full).split(path.sep).join('/')]
    })
  return walk(assetsDir).sort()
}

/** Copy the previous build's assets that the new site lacks. Returns the copied paths. */
export function carryForward(prevDir, siteDir) {
  const copied = []
  for (const rel of previousAssets(prevDir)) {
    const from = path.join(prevDir, 'assets', rel)
    const to = path.join(siteDir, 'assets', rel)
    // Stay inside assets/ whatever the manifest says.
    if (path.relative(path.join(siteDir, 'assets'), to).startsWith('..')) continue
    if (!existsSync(from) || existsSync(to)) continue
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(from, to)
    copied.push(rel)
  }
  return copied
}

function main() {
  const [prevDir, siteDir] = process.argv.slice(2).map((p) => path.resolve(p))
  if (!prevDir || !siteDir) {
    console.error('usage: node scripts/carry-forward-assets.mjs <previous-site-dir> <new-site-dir>')
    process.exit(2)
  }
  if (!existsSync(path.join(siteDir, 'assets'))) {
    console.error(`carry-forward-assets: ${siteDir} has no assets/ directory`)
    process.exit(2)
  }
  if (!existsSync(prevDir)) {
    console.log('carry-forward-assets: no previous site, nothing to carry')
    return
  }
  const copied = carryForward(prevDir, siteDir)
  console.log(`carry-forward-assets: kept ${copied.length} file(s) from the previous deploy`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
