#!/usr/bin/env node
/**
 * Gate: the heavy libraries stay out of what loads before first paint.
 *
 *   node scripts/check-entry-closure.mjs [--dist <dir>]      (npm run check:closure)
 *
 * Walks dist/aiui-manifest.json and takes the static closure (chunks loaded
 * together, no lazy imports) of three roots:
 *
 *   entry        assets/index.js
 *   shell mount  the React shell (style `app`)
 *   legacy app   legacy-app-entry (styles chat, docs, agents, playground, custom)
 *
 * It fails when a chunk in one of those closures is, or contains, Streamdown,
 * Shiki, Mermaid, KaTeX or assistant-ui. Each library is recognised two ways,
 * because the manifest lists chunks, not the modules inside them:
 *
 *   - by manifest key (node_modules/<lib>/...), for chunks that are a module
 *   - by a string only that library's code contains, for a library that was
 *     merged into a shared chunk
 *
 * Every fingerprint must also be found somewhere in dist/assets, so a
 * fingerprint that a library upgrade removed fails here instead of silently
 * matching nothing.
 *
 * Also checks that no chunk imports the entry (it is loaded as
 * index.js?v=<hash>, so `import "./index.js"` would run it twice).
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DIST, ManifestError, distPath, filesOf, loadManifest, namedChunks, staticClosure } from './lib/build-manifest.mjs'

const HEAVY = [
  { name: 'streamdown', key: /node_modules\/streamdown\//, fingerprint: 'data-streamdown' },
  { name: 'shiki', key: /node_modules\/(shiki|@shikijs)\//, fingerprint: 'ShikiError' },
  { name: 'mermaid', key: /node_modules\/mermaid\//, fingerprint: 'mermaidAPI' },
  { name: 'katex', key: /node_modules\/katex\//, fingerprint: 'KaTeX parse error' },
  { name: '@assistant-ui', key: /node_modules\/@assistant-ui\//, fingerprint: '@assistant-ui' },
]

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function main() {
  const dist = path.resolve(argValue('--dist') ?? DIST)
  const manifest = loadManifest(dist)
  const chunks = namedChunks(manifest)
  const roots = {
    'entry (assets/index.js)': [chunks.entry],
    'shell mount': [chunks.shellMount],
    'legacy app': [chunks.legacyApp],
  }

  const source = new Map()
  const read = (file) => {
    if (!source.has(file)) source.set(file, readFileSync(distPath(file, dist), 'utf8'))
    return source.get(file)
  }

  const problems = []

  // 1. every fingerprint still identifies something in this build
  const allJs = readdirSync(path.join(dist, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `assets/${f}`)
  for (const lib of HEAVY) {
    if (!allJs.some((file) => read(file).includes(lib.fingerprint))) {
      problems.push(
        `fingerprint "${lib.fingerprint}" for ${lib.name} is in no chunk: update HEAVY in scripts/check-entry-closure.mjs`,
      )
    }
  }

  // 2. the three closures are free of the heavy libraries
  for (const [label, keys] of Object.entries(roots)) {
    const closure = staticClosure(manifest, keys)
    const found = []
    for (const key of closure) {
      for (const lib of HEAVY) {
        if (lib.key.test(key)) found.push(`${label}: statically loads ${lib.name} (${key})`)
      }
    }
    for (const file of filesOf(manifest, closure)) {
      for (const lib of HEAVY) {
        if (read(file).includes(lib.fingerprint)) found.push(`${label}: ${file} contains ${lib.name}`)
      }
    }
    console.log(`check-entry-closure: ${label}: ${closure.size} chunks, ${found.length ? 'NOT clean' : 'clean'}`)
    problems.push(...found)
  }

  // 3. nothing imports the entry
  const entryFile = manifest[chunks.entry].file
  for (const [key, c] of Object.entries(manifest)) {
    if (key === chunks.entry) continue
    if ([...(c.imports ?? []), ...(c.dynamicImports ?? [])].includes(chunks.entry)) {
      problems.push(`${c.file} imports the entry ${entryFile}; it would be evaluated twice`)
    }
  }

  if (problems.length) {
    console.error('check-entry-closure: FAILED')
    for (const p of [...new Set(problems)]) console.error(`  - ${p}`)
    console.error('Load these libraries with React.lazy / import() so they stay out of the first screen.')
    process.exit(1)
  }
  console.log('check-entry-closure: OK')
}

try {
  main()
} catch (error) {
  if (error instanceof ManifestError) {
    console.error(`check-entry-closure: ${error.message}`)
    process.exit(1)
  }
  throw error
}
