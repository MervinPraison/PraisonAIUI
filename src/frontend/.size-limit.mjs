/**
 * Size budgets (`npm run size`, after `npm run build`). Gzip, level 9.
 *
 * Chunk names are content-hashed, so every path comes from the Vite manifest
 * (dist/aiui-manifest.json) through scripts/lib/build-manifest.mjs, never from
 * a glob on a name. "Closure" means a chunk plus everything it imports
 * statically: what the browser must download before that code can run.
 *
 * Budgets are the numbers measured when the React shell landed plus roughly
 * 10% headroom. Raise one only with a reason in the commit message.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { DIST, distPath, filesOf, loadManifest, namedChunks, staticClosure } from './scripts/lib/build-manifest.mjs'

const manifest = loadManifest()
const chunks = namedChunks(manifest)
const abs = (files) => files.map((f) => distPath(f))

// What the app shell (style `app`) loads before it can paint: the entry, the
// shell mount chunk and their static imports, with their stylesheets.
const bootClosure = staticClosure(manifest, [chunks.entry, chunks.shellMount])
const bootJs = filesOf(manifest, bootClosure)
const bootAll = filesOf(manifest, bootClosure, { css: true })

// What opening /chat adds on top of the boot closure.
const chatClosure = staticClosure(manifest, [chunks.chatPage])
const chatRouteJs = filesOf(manifest, chatClosure).filter((f) => !bootJs.includes(f))

// The chat / docs / agents / playground / custom styles: entry + legacy App.
const legacyJs = filesOf(manifest, staticClosure(manifest, [chunks.entry, chunks.legacyApp]))

// Everything under dist/assets ships in the Python wheel.
const allAssets = readdirSync(path.join(DIST, 'assets'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath, entry.name))

export default [
  { name: 'shell boot (JS + CSS before first paint)', path: abs(bootAll), limit: '150 kB', gzip: true },
  { name: 'chat route (added by /chat)', path: abs(chatRouteJs), limit: '140 kB', gzip: true },
  { name: '/chat first screen JS (boot + chat route)', path: abs([...bootJs, ...chatRouteJs]), limit: '250 kB', gzip: true },
  { name: 'index.css', path: abs(['assets/index.css']), limit: '32 kB', gzip: true },
  // The 145 kB budget was set with `gzip -9` (reference zlib), which gives
  // 144.8 kB for this chunk. size-limit compresses with Node's zlib (Chromium's
  // fork), which gives 146.6 kB for the same bytes: 147 kB is that budget here.
  { name: 'Streamdown renderer chunk', path: abs([manifest[chunks.streamdown].file]), limit: '147 kB', gzip: true },
  { name: 'shikiPlugin chunk', path: abs([manifest[chunks.shikiPlugin].file]), limit: '55 kB', gzip: true },
  { name: 'legacy App path (entry + legacy-app-entry closure)', path: abs(legacyJs), limit: '250 kB', gzip: true },
  // Uncompressed: this is what the wheel carries.
  { name: 'wheel: all of dist/assets (uncompressed)', path: allAssets, limit: '9 MB', brotli: false },
]
