#!/usr/bin/env node
/**
 * Gate (ADR 0003 R17): an inactive layout's code is never downloaded.
 *
 *   node scripts/check-layout-isolation.mjs [--dist <dir>] [--src <dir>]
 *
 * Reads dist/aiui-manifest.json. vite.config.ts names the chunks of
 * src/app-layouts/<id>/ `layout-<id>`, of src/app-layouts/kit/ `layout-kit`
 * and of src/layout-features/<name>/ `lf-<name>` (a group may span several
 * chunks). "Closure" is a chunk plus what it imports statically: what the
 * browser downloads with it. The gate fails when
 *
 *   1. the boot closure (entry + shell mount) or the legacy App closure
 *      holds any layout, kit or feature chunk;
 *   2. a chunk outside a layout group statically imports one (only a
 *      layout's own chunks may; the kit may be imported by layouts and
 *      features; anyone may import() a layout lazily);
 *   3. a layout's closure holds another layout's chunk or any feature chunk
 *      (features load with import()), or a feature's closure holds a layout;
 *   4. a layout, kit or feature closure contains Streamdown, Shiki,
 *      Mermaid, KaTeX or @assistant-ui (by manifest key or fingerprint);
 *   5. a folder under src/app-layouts or src/layout-features has no chunk
 *      of its name (its descriptor is not registered, or naming broke).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIST, FRONTEND_ROOT, ManifestError, distPath, filesOf, loadManifest, namedChunks, staticClosure } from './lib/build-manifest.mjs'

/** Libraries no layout or kit may pull in (same fingerprints as check-entry-closure.mjs). */
export const HEAVY = [
  { name: 'streamdown', key: /node_modules\/streamdown\//, fingerprint: 'data-streamdown' },
  { name: 'shiki', key: /node_modules\/(shiki|@shikijs)\//, fingerprint: 'ShikiError' },
  { name: 'mermaid', key: /node_modules\/mermaid\//, fingerprint: 'mermaidAPI' },
  { name: 'katex', key: /node_modules\/katex\//, fingerprint: 'KaTeX parse error' },
  { name: '@assistant-ui', key: /node_modules\/@assistant-ui\//, fingerprint: '@assistant-ui' },
]

export const KIT = 'layout-kit'
const LAYOUT = /^layout-[a-z][a-z0-9-]*$/
const FEATURE = /^lf-[a-z][a-z0-9-]*$/

/** The layout group a chunk belongs to (`layout-<id>`, `layout-kit`, `lf-<name>`), or null. */
export function groupOf(chunk) {
  const name = chunk?.name ?? ''
  return LAYOUT.test(name) || FEATURE.test(name) ? name : null
}

const isLayout = (g) => g !== null && g !== KIT && LAYOUT.test(g)
const isFeature = (g) => g !== null && FEATURE.test(g)

/** Folder names under `dir` (each one a layout or feature), or [] when it does not exist. */
function folders(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => /^[a-z][a-z0-9-]*$/.test(n) && statSync(path.join(dir, n)).isDirectory())
}

/** Every problem the gate finds in `manifest` (an empty list passes). */
export function isolationProblems(manifest, { read, srcDir } = {}) {
  const problems = []
  const chunks = namedChunks(manifest)
  const groups = new Map() // group -> manifest keys
  for (const [key, c] of Object.entries(manifest)) {
    const g = groupOf(c)
    if (!g) continue
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(key)
  }
  const groupsIn = (closure) => new Set([...closure].map((k) => groupOf(manifest[k])).filter(Boolean))

  // 1. nothing of a layout before first paint, nor in the legacy App
  for (const [label, roots] of [
    ['boot (entry + shell mount)', [chunks.entry, chunks.shellMount]],
    ['legacy app', [chunks.entry, chunks.legacyApp]],
  ]) {
    for (const g of groupsIn(staticClosure(manifest, roots))) problems.push(`${label} statically loads ${g}`)
  }

  // 2. only a layout's own chunks (and features, for the kit) import its chunks statically
  for (const [key, c] of Object.entries(manifest)) {
    const own = groupOf(c)
    for (const dep of c.imports ?? []) {
      const g = groupOf(manifest[dep])
      if (!g || g === own) continue
      if (g === KIT && (isLayout(own) || isFeature(own))) continue
      problems.push(`${c.file} (${own ?? c.name ?? key}) statically imports ${g}; load it with import()`)
    }
  }

  // 3 + 4. each group's closure
  for (const [g, keys] of groups) {
    const closure = staticClosure(manifest, keys)
    for (const other of groupsIn(closure)) {
      if (other === g || other === KIT) continue
      if (isLayout(g) && (isLayout(other) || isFeature(other))) problems.push(`${g} statically loads ${other}`)
      else if (isFeature(g) && isLayout(other)) problems.push(`${g} statically loads ${other} (features never import a layout)`)
      else if (g === KIT) problems.push(`${KIT} statically loads ${other}`)
    }
    if (isFeature(g)) continue // features may use the markdown and highlight chunks lazily or not: their own budget
    for (const key of closure) {
      for (const lib of HEAVY) if (lib.key.test(key)) problems.push(`${g} statically loads ${lib.name} (${key})`)
    }
    if (read) {
      for (const file of filesOf(manifest, closure)) {
        for (const lib of HEAVY) if (read(file).includes(lib.fingerprint)) problems.push(`${g}: ${file} contains ${lib.name}`)
      }
    }
  }

  // 5. every layout and feature folder was built under its name
  if (srcDir) {
    const expect = [
      ...folders(path.join(srcDir, 'app-layouts')).map((id) => `layout-${id}`),
      ...folders(path.join(srcDir, 'layout-features')).map((n) => `lf-${n}`),
    ]
    for (const g of expect) {
      if (!groups.has(g)) {
        problems.push(
          `no ${g} chunk in the build: register its descriptor (src/builtin/layouts) and import its folder only lazily`,
        )
      }
    }
  }
  return [...new Set(problems)]
}

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function main() {
  const dist = path.resolve(argValue('--dist') ?? DIST)
  const srcDir = path.resolve(argValue('--src') ?? path.join(FRONTEND_ROOT, 'src'))
  const manifest = loadManifest(dist)
  const cache = new Map()
  const read = (file) => {
    if (!cache.has(file)) cache.set(file, readFileSync(distPath(file, dist), 'utf8'))
    return cache.get(file)
  }
  const problems = isolationProblems(manifest, { read, srcDir })
  const groups = [...new Set(Object.values(manifest).map(groupOf).filter(Boolean))].sort()
  console.log(`check-layout-isolation: ${groups.length} groups (${groups.join(', ') || 'none'})`)
  if (problems.length) {
    console.error('check-layout-isolation: FAILED')
    for (const p of problems) console.error(`  - ${p}`)
    console.error('A layout loads only when it is selected, and never brings another layout or feature with it (ARCHITECTURE.md R17).')
    process.exit(1)
  }
  console.log('check-layout-isolation: OK')
}

// Run as a script; importing it (tests, other gates) only exposes isolationProblems().
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    if (error instanceof ManifestError) {
      console.error(`check-layout-isolation: ${error.message}`)
      process.exit(1)
    }
    throw error
  }
}
