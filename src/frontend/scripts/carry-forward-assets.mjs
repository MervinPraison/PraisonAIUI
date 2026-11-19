#!/usr/bin/env node
/**
 * Keep the previous deploy's chunks alive for one more release of a static site.
 *
 *   node scripts/carry-forward-assets.mjs <previous-site-dir> <new-site-dir> [--keep-days N]
 *
 * A static deploy replaces every file. A reader who still has the previous
 * page open (or cached) then asks for chunks that no longer exist, and lazy
 * parts of the page (code highlighting, diagrams, math) fail until they
 * reload. This copies the previous build's assets into the new site, next to
 * the new ones, so both generations work.
 *
 * Which files are carried:
 *   - previous site has aiui-manifest.json (written by `aiui build`): the
 *     files that manifest lists, i.e. the previous build's own files, plus the
 *     files its own carry ledger (aiui-carried.json) lists that left a build
 *     less than `--keep-days` (default 2) ago. A docs site deploys on many
 *     merges a day while a tab stays open for hours, so one release back is
 *     not enough; the ledger keeps the site from growing for ever.
 *   - no manifest (a site built before chunks were hashed): every file in its
 *     assets/ directory.
 * A file that also exists in the new build is never overwritten. The new
 * site gets the ledger (aiui-carried.json: carried file -> when it first
 * left a build), for the next deploy to read.
 *
 * Exits 0 when there is no previous site (first deploy).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MANIFEST = 'aiui-manifest.json'
export const LEDGER = 'aiui-carried.json'
export const KEEP_DAYS = 2
const DAY_MS = 24 * 60 * 60 * 1000

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

/** The previous site's ledger: assets/-relative path -> ms when it left a build ({} when none). */
function readLedger(prevDir) {
  try {
    const files = JSON.parse(readFileSync(path.join(prevDir, LEDGER), 'utf8')).files
    return Object.fromEntries(
      Object.entries(files ?? {}).filter(([rel, at]) => typeof rel === 'string' && Number.isFinite(Date.parse(at))).map(([rel, at]) => [rel, Date.parse(at)]),
    )
  } catch {
    return {}
  }
}

/**
 * Copy the previous build's assets, and the older ones still within
 * `keepDays`, that the new site lacks; write the new site's ledger. Returns
 * the copied paths.
 */
export function carryForward(prevDir, siteDir, { now = Date.now(), keepDays = KEEP_DAYS } = {}) {
  const copied = []
  const ledger = {}
  const since = { ...readLedger(prevDir) }
  for (const rel of previousAssets(prevDir)) since[rel] ??= now // left a build with this deploy
  for (const [rel, at] of Object.entries(since).sort()) {
    if (now - at >= keepDays * DAY_MS) continue
    const from = path.join(prevDir, 'assets', rel)
    const to = path.join(siteDir, 'assets', rel)
    // Stay inside assets/ whatever the manifest says.
    if (path.relative(path.join(siteDir, 'assets'), to).startsWith('..')) continue
    if (!existsSync(from) || existsSync(to)) continue
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(from, to)
    copied.push(rel)
    ledger[rel] = new Date(at).toISOString()
  }
  writeFileSync(path.join(siteDir, LEDGER), JSON.stringify({ keepDays, files: ledger }, null, 1) + '\n')
  return copied
}

function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--keep-days')
  const keepDays = at >= 0 ? Number(args.splice(at, 2)[1]) : KEEP_DAYS
  const [prevDir, siteDir] = args.map((p) => path.resolve(p))
  if (!prevDir || !siteDir || !(keepDays >= 0)) {
    console.error('usage: node scripts/carry-forward-assets.mjs <previous-site-dir> <new-site-dir> [--keep-days N]')
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
  const copied = carryForward(prevDir, siteDir, { keepDays })
  console.log(`carry-forward-assets: kept ${copied.length} file(s) from earlier deploys (up to ${keepDays} day(s) old)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
