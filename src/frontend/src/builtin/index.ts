/**
 * The first-party browser plugins. This list is the ONLY place the app names
 * its own pages: the shell (src/shell) and the SDK (src/sdk) never import a
 * feature module or mention a page id (enforced by shell/core-purity.test.ts).
 * Porting another page to React means adding an entry here, not editing the
 * shell.
 */
import { sdkApi } from '@/sdk/install'
import { chatBuiltin } from './chat'
import type { BuiltinPlugin, BuiltinSdk } from './types'

export type { BuiltinPlugin, BuiltinSdk } from './types'

export const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = Object.freeze([chatBuiltin])

const activated = new Set<string>()

/**
 * Activate every built-in once. A failing built-in is reported and skipped;
 * the others still activate (the same isolation third-party modules get).
 * Returns the names activated by this call.
 */
export function activateBuiltins(
  sdk: BuiltinSdk = sdkApi,
  plugins: readonly BuiltinPlugin[] = BUILTIN_PLUGINS,
): string[] {
  const done: string[] = []
  for (const plugin of plugins) {
    if (activated.has(plugin.name)) continue
    activated.add(plugin.name)
    try {
      plugin.activate(sdk)
      done.push(plugin.name)
    } catch (err) {
      console.error(`[aiui builtin] ${plugin.name} failed to activate`, err)
    }
  }
  return done
}

/** Test hook: forget which built-ins were activated. */
export function resetBuiltinsForTests(): void {
  activated.clear()
}
