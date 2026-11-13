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

/** The public SDK module, exactly as plugins get it from `@aiui/sdk`. */
export type BuiltinSdk = typeof sdkApi

export interface BuiltinPlugin {
  /** Record name, `builtin.<domain>` (the Python side uses the same names). */
  readonly name: string
  /** Page ids this plugin renders. */
  readonly pages: readonly string[]
  /** Register pages, blocks, tool renderers and slots. Runs at most once. */
  activate(sdk: BuiltinSdk): void
}
