/**
 * The first-party browser plugins. This list is the ONLY place the app names
 * its own pages: the shell (src/shell) and the SDK (src/sdk) never import a
 * feature module or mention a page id (enforced by shell/core-purity.test.ts).
 * Porting another page to React means adding an entry here, not editing the
 * shell.
 */
import { sdkApi } from '@/sdk/install'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import { approvalsBuiltin } from './approvals'
import { chatBuiltin } from './chat'
import type { BuiltinPlugin, BuiltinSdk } from './types'

export type { BuiltinContext, BuiltinPlugin, BuiltinSdk } from './types'

export const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = Object.freeze([chatBuiltin, approvalsBuiltin])

const activated = new Set<string>()

/**
 * True for a manifest page the server lists as its own built-in. When an app
 * (`aiui.register_page`) or a plugin provides a page under a built-in id, the
 * manifest says so in `source`, and that page is theirs to render. A manifest
 * without `source` (older server) counts as built-in.
 */
export function isBuiltinPage(page: ShellPage): boolean {
  const source = page.source
  return !source || source === 'builtin' || source.startsWith('builtin.') || source.startsWith('builtin:')
}

/**
 * Activate, once each, the built-ins this server's manifest has pages for,
 * and the `always` ones (services). A built-in none of whose pages are in the
 * manifest (hidden by set_pages or pages.disabled) stays inactive, so its URL
 * shows "Page not found" like any unknown id. A failing built-in is reported and skipped; the others still
 * activate (the isolation third-party modules get). Returns the names
 * activated by this call.
 */
export function activateBuiltins(
  manifest: ShellManifest,
  sdk: BuiltinSdk = sdkApi,
  plugins: readonly BuiltinPlugin[] = BUILTIN_PLUGINS,
): string[] {
  const listed = new Set(manifest.pages.filter(isBuiltinPage).map((p) => p.id))
  const done: string[] = []
  for (const plugin of plugins) {
    if (activated.has(plugin.name)) continue
    const pageIds = plugin.pages.filter((id) => listed.has(id))
    if (pageIds.length === 0 && !plugin.always) continue
    activated.add(plugin.name)
    try {
      plugin.activate(sdk, { manifest, pageIds })
      done.push(plugin.name)
    } catch (err) {
      console.error(`[aiui builtin] ${plugin.name} failed to activate`, err)
    }
  }
  return done
}

let installed = false

/**
 * Queue the built-ins on the SDK's `onActivate` hook, the same hook a plugin
 * module uses. The shell runs the hooks when it has the manifest
 * (activateShell), before the first render. Idempotent.
 */
export function installBuiltins(sdk: BuiltinSdk = sdkApi): void {
  if (installed) return
  installed = true
  sdk.onActivate(({ manifest }) => {
    activateBuiltins(manifest, sdk)
  })
}

/** Test hook: forget which built-ins were installed and activated. */
export function resetBuiltinsForTests(): void {
  activated.clear()
  installed = false
}
