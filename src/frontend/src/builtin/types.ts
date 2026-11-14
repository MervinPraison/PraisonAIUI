/**
 * First-party browser plugins ("built-ins").
 *
 * A built-in contributes through the same public `@aiui/sdk` object a
 * third-party plugin module imports: nothing here reaches into the shell.
 * The only difference from a third-party plugin is delivery: a built-in ships
 * inside the app bundle (its heavy code still sits in lazy chunks), a
 * third-party module is imported from a manifest URL.
 */
import type { sdkApi } from '@/sdk/install'
import type { ShellManifest } from '@/sdk/manifest'

/** The public SDK module, exactly as plugins get it from `@aiui/sdk`. */
export type BuiltinSdk = typeof sdkApi

export interface BuiltinContext {
  readonly manifest: ShellManifest
  /**
   * The plugin's page ids this server's manifest lists. Never empty, except
   * for an `always` plugin.
   */
  readonly pageIds: readonly string[]
}

export interface BuiltinPlugin {
  /** Record name, `builtin.<domain>` (the Python side uses the same names). */
  readonly name: string
  /** Page ids this plugin renders. */
  readonly pages: readonly string[]
  /**
   * A service rather than a page (notifications, commands): activate even
   * when the manifest lists none of `pages`, which may then be empty.
   */
  readonly always?: boolean
  /**
   * Register pages, blocks, tool renderers, slots and commands. Runs at most
   * once, and only when the manifest lists at least one of `pages` (or the
   * plugin is `always`): a page the server hides (set_pages, pages.disabled)
   * must not be registered, or its URL would still render.
   */
  activate(sdk: BuiltinSdk, ctx: BuiltinContext): void
}
