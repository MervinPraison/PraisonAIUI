#!/usr/bin/env node
/**
 * A content hash of a built static site, so a deploy can skip publishing a
 * site that has not changed.
 *
 *   node scripts/site-hash.mjs <site-dir> [--previous <hash-file>]
 *
 * Run it on the fresh build, before carry-forward-assets.mjs adds the
 * previous deploy's chunks. It writes the hash to <site-dir>/aiui-site-hash.txt
 * (published with the site, so the next deploy can compare) and prints
 * `hash=<sha256>` and `changed=true|false` lines, the format of
 * $GITHUB_OUTPUT. `changed` is false only when --previous names a file
 * holding the same hash; a missing or unreadable file (the first deploy, a
 * site deployed before this script) counts as changed.
 *
 * The hash covers every file's relative path and bytes, in sorted order,
 * except the hash file itself and one value that is not content: a sitemap's
 * <lastmod> dates. `aiui build` takes those from file modification times,
 * which in CI are the checkout time, so they change on every run although the
 * pages did not.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HASH_FILE = 'aiui-site-hash.txt'

const SITEMAP = /^sitemap[^/]*\.xml$/

/** Every file under `dir`, as sorted `/`-separated relative paths. */
function listFiles(dir, prefix = '') {
  const out = []
  for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listFiles(dir, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/** The bytes a file contributes to the hash. */
function contentOf(siteDir, rel) {
  const bytes = readFileSync(path.join(siteDir, rel))
  if (!SITEMAP.test(path.basename(rel))) return bytes
  return Buffer.from(bytes.toString('utf8').replace(/<lastmod>[^<]*<\/lastmod>/g, '<lastmod/>'))
}

/** sha256 over the site's sorted paths and contents (the hash file excluded). */
export function siteHash(siteDir) {
  const hash = createHash('sha256')
  const files = listFiles(siteDir).filter((rel) => rel !== HASH_FILE).sort()
  for (const rel of files) {
    const content = contentOf(siteDir, rel)
    hash.update(`${rel}\0${content.length}\0`)
    hash.update(content)
  }
  return hash.digest('hex')
}

/** The hash a previous deploy published, or null. */
export function readHash(file) {
  try {
    const text = readFileSync(file, 'utf8').trim()
    return /^[0-9a-f]{64}$/.test(text) ? text : null
  } catch {
    return null
  }
}

function main() {
  const args = process.argv.slice(2)
  const siteDir = args[0]
  const at = args.indexOf('--previous')
  if (!siteDir || (at >= 0 && !args[at + 1])) {
    console.error('usage: site-hash.mjs <site-dir> [--previous <hash-file>]')
    process.exit(2)
  }
  const hash = siteHash(siteDir)
  writeFileSync(path.join(siteDir, HASH_FILE), `${hash}\n`)
  const previous = at >= 0 ? readHash(args[at + 1]) : null
  console.log(`hash=${hash}`)
  console.log(`changed=${previous !== hash}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
