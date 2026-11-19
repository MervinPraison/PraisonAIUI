/**
 * Which files of src/praisonaiui/templates/frontend are build output.
 *
 * One list for `npm run sync` (sync-templates.mjs copies them),
 * `npm run check:bundle` (check-bundle-sync.mjs compares them) and CI's
 * "does this pull request touch the frontend?" step (touches-frontend.mjs),
 * so a built file cannot be synced and compared but missed by CI.
 * Everything else in that folder (plugins/, chat.css, ...) is hand-written.
 */

// aiui-sdk.d.ts: the @aiui/sdk typings (gen-externals), shipped so plugin
// authors who pip-install praisonaiui can type-check against them.
export const BUNDLE_ROOT_FILES = [
  'index.html',
  'icon.svg',
  'aiui-manifest.json',
  'aiui-externals.json',
  'aiui-sdk.d.ts',
  // Every lucide icon name (scripts/lib/lucide-icons.mjs): `aiui validate` warns on any other.
  'aiui-icons.json',
  // Every bundled code theme (scripts/lib/code-themes.mjs): `aiui build` checks site.theme.code.
  'aiui-code.json',
]

const COPY_PREFIX = 'src/praisonaiui/templates/frontend/'

/** True when a repo-relative path is frontend source or a built bundle file. */
export function isFrontendPath(file) {
  if (file.startsWith('src/frontend/')) return true
  if (!file.startsWith(COPY_PREFIX)) return false
  const rel = file.slice(COPY_PREFIX.length)
  return rel.startsWith('assets/') || BUNDLE_ROOT_FILES.includes(rel)
}
