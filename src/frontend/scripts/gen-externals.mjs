#!/usr/bin/env node
/**
 * Post-build step (`npm run build` runs it as `postbuild`).
 *
 * Writes dist/aiui-externals.json: the named exports of every bare specifier a
 * plugin may import (ADR-0001 §8). The server builds its
 * /_aiui/externals/*.js ESM shims from this file, so the shims always match
 * the React version actually bundled instead of a hand-written list.
 *
 *   {
 *     "schema": 1,
 *     "sdkVersion": 1,
 *     "react": "19.2.4",
 *     "modules": {
 *       "react": ["Children", ...],
 *       "react/jsx-runtime": [...],
 *       "react-dom": [...],
 *       "react-dom/client": [...],
 *       "@aiui/sdk": [...]            // SDK_EXPORTS from src/sdk/manifest.ts
 *     }
 *   }
 *
 * Export lists are the union of React's production and development builds,
 * restricted to valid JS identifiers, sorted, without `default`.
 *
 * Usage: node scripts/gen-externals.mjs [--out <file>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(ROOT, 'package.json'))
const IDENT = /^[A-Za-z_$][\w$]*$/

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const outFile = path.resolve(ROOT, argValue('--out') ?? 'dist/aiui-externals.json')

/** Load src/sdk/manifest.ts on its own (it has no runtime imports). */
async function loadManifestModule() {
  const file = path.join(ROOT, 'src', 'sdk', 'manifest.ts')
  const { code } = await esbuild.transform(readFileSync(file, 'utf8'), {
    loader: 'ts',
    format: 'esm',
    target: 'node22',
    sourcefile: file,
  })
  if (/^\s*import\s/m.test(code)) {
    throw new Error('src/sdk/manifest.ts must not have runtime imports (gen-externals loads it standalone)')
  }
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

/** Object.keys of a CommonJS package entry, loaded under a given NODE_ENV. */
function exportsUnder(specifier, nodeEnv) {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = nodeEnv
  try {
    const resolved = require.resolve(specifier)
    // The package entry picks ./cjs/*.{production,development}.js at require
    // time; drop it from the cache so the other build is loaded next time.
    delete require.cache[resolved]
    return Object.keys(require(specifier))
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev
  }
}

function exportNames(specifier) {
  const names = new Set([...exportsUnder(specifier, 'production'), ...exportsUnder(specifier, 'development')])
  names.delete('default')
  names.delete('__esModule')
  return [...names].filter((n) => IDENT.test(n)).sort()
}

const manifest = await loadManifestModule()
const { SHELL_EXTERNALS, SDK_EXPORTS, SDK_VERSION } = manifest

if (!Array.isArray(SHELL_EXTERNALS) || !Array.isArray(SDK_EXPORTS)) {
  throw new Error('src/sdk/manifest.ts must export SHELL_EXTERNALS and SDK_EXPORTS arrays')
}
const badSdk = SDK_EXPORTS.filter((n) => typeof n !== 'string' || !IDENT.test(n))
if (badSdk.length) throw new Error(`SDK_EXPORTS has invalid identifiers: ${badSdk.join(', ')}`)
if (new Set(SDK_EXPORTS).size !== SDK_EXPORTS.length) throw new Error('SDK_EXPORTS has duplicates')

const modules = {}
for (const spec of SHELL_EXTERNALS) {
  if (spec === '@aiui/sdk') {
    modules[spec] = [...SDK_EXPORTS]
    continue
  }
  const names = exportNames(spec)
  if (names.length === 0) throw new Error(`no exports found for ${spec}`)
  modules[spec] = names
}

for (const required of ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@aiui/sdk']) {
  if (!modules[required]) throw new Error(`SHELL_EXTERNALS is missing ${required}`)
}

const out = {
  schema: 1,
  sdkVersion: SDK_VERSION,
  react: require('react/package.json').version,
  modules,
}

mkdirSync(path.dirname(outFile), { recursive: true })
writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`)
const counts = Object.entries(modules)
  .map(([k, v]) => `${k}=${v.length}`)
  .join(' ')
console.log(`gen-externals: wrote ${path.relative(ROOT, outFile)} (React ${out.react}; ${counts})`)
