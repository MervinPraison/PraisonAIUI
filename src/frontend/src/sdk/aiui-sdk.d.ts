/**
 * Types of the `@aiui/sdk` module a PraisonAIUI browser plugin imports.
 *
 * `@aiui/sdk` is not an npm package: the app shell provides it at runtime
 * through its import map. To type-check a plugin, copy this file into the
 * plugin project (it is also written to `dist/aiui-sdk.d.ts` by the frontend
 * build) and include it in tsconfig/jsconfig. It depends on `@types/react`
 * only.
 *
 * The export names equal SDK_EXPORTS (sdk/manifest.ts); sdk/install.ts
 * checks at compile time that the real module satisfies these declarations,
 * and sdk/services.test.ts checks the names.
 *
 * Keep this file free of top-level imports and exports: it must stay an
 * ambient declaration.
 */
declare module '@aiui/sdk' {
  type ComponentType<P = Record<string, never>> = import('react').ComponentType<P>

  // ── manifest ───────────────────────────────────────────────────────

  export type ShellPageKind = 'native' | 'react' | 'blocks' | 'legacy' | 'iframe'

  /** One page of the app, as the server lists it. */
  export interface ShellPage {
    id: string
    title: string
    kind: ShellPageKind
    icon?: string
    group?: string
    order?: number
    description?: string
    apiEndpoint?: string | null
    actionEndpoint?: string
    module?: string
    css?: string
    integrity?: string
    layout?: string
    /** Who provides the page: `builtin`, `app`, `plugin:<name>`, … */
    source?: string
  }

  export type ShellPluginStatus = 'ok' | 'error' | 'disabled' | 'incompatible' | 'disabled-by-default'

  /** Where a plugin record comes from. */
  export type ShellPluginOrigin = 'entry-point' | 'manual' | 'builtin'

  export interface ShellPluginRecord {
    name: string
    version?: string
    status: ShellPluginStatus
    error?: string
    /** Older servers omit it. */
    origin?: ShellPluginOrigin
    /** Built-ins only: the host needs part of this plugin even when disabled. */
    required?: boolean
  }

  /** GET /api/shell/manifest. */
  export interface ShellManifest {
    sdk: number
    version: string
    style: string
    site: Record<string, unknown>
    layout: { sidebar?: unknown; pageHeader?: unknown }
    pages: ShellPage[]
    blocks: { type: string; module: string; integrity?: string; source: string }[]
    toolRenderers: { toolName: string; module: string; integrity?: string; source: string }[]
    plugins: ShellPluginRecord[]
    legacy: { customJs: string | null; viewsBase: string }
  }

  // ── registry ───────────────────────────────────────────────────────

  /** A node of a server-driven blocks page. Flat dict keys are in `props`. */
  export interface BlockNode {
    type: string
    props?: Record<string, unknown>
    children?: BlockNode[] | string
  }

  export type PageComponent = ComponentType<{ page: ShellPage }>
  export type PageLoader = () => Promise<{ default: PageComponent }>
  export type BlockComponent = ComponentType<{ node: BlockNode; page?: ShellPage }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyComponent = ComponentType<any>

  /** Major version of the SDK (`window.__AIUI_SDK__.version`). */
  export const SDK_VERSION: number

  /**
   * Capabilities of the running shell's SDK. Feature-detect before using a
   * newer export: `SDK_FEATURES.includes('commands')`.
   */
  export const SDK_FEATURES: readonly string[]

  /** Render a page id with a component, or with a loader returning `import()`. */
  export function registerPage(id: string, component: PageComponent | PageLoader): void
  export interface BlockOptions {
    /**
     * Register a default renderer, used only while nothing else renders the
     * type: it never replaces an existing entry, and a later plain
     * registerBlock (or a custom.js registerComponent) wins over it. Needs
     * the `blocks.fallback` feature.
     */
    fallback?: boolean
  }
  /**
   * Render a block type on server-driven blocks pages. A plain registration
   * also overrides a built-in block type of the same name.
   */
  export function registerBlock(type: string, component: BlockComponent, options?: BlockOptions): void
  /** Render the calls of a tool in the chat thread. */
  export function registerToolRenderer(toolName: string, component: AnyComponent): void
  export interface SlotOptions {
    /**
     * Identity of this contribution within the slot (by convention the plugin
     * name), so several plugins can share a slot. Without it the call sets the
     * slot's single default contribution, replacing an earlier default.
     */
    id?: string
    /** Position within the slot: lower comes first. Default 100. */
    order?: number
  }
  /**
   * Contribute a component to a named slot of the shell: `header:actions`,
   * `sidebar:footer` or `page:<id>:toolbar`. The component receives
   * `{ slot, pageId, page? }` (`sidebar:footer` also gets `collapsed`).
   * Passing `options` needs the `slots.multi` feature.
   */
  export function registerSlot(slot: string, component: AnyComponent, options?: SlotOptions): void
  /** Register a vanilla view (`render(container)`), like custom.js `window.aiui.registerView`. */
  export function registerView(
    pageId: string,
    render: (container: HTMLElement) => unknown,
    cleanup?: () => void,
  ): void

  export function getPage(id: string): PageComponent | undefined
  export function getBlock(type: string): BlockComponent | undefined
  export function getSlot(name: string): AnyComponent | undefined
  export function getToolRenderers(): Record<string, AnyComponent>
  /** Called after every registration change. Returns an unsubscribe function. */
  export function subscribe(listener: () => void): () => void
  /** React hook: re-renders the caller whenever anything is (re-)registered. */
  export function useRegistryVersion(): number

  // ── components ─────────────────────────────────────────────────────

  export interface MarkdownProps {
    children: string
    variant?: 'chat' | 'docs'
    streaming?: boolean
    className?: string
    components?: Record<string, AnyComponent>
  }
  /** The shell's markdown renderer (lazy; shows a skeleton while it loads). */
  export const Markdown: ComponentType<MarkdownProps>

  // ── shell services ─────────────────────────────────────────────────

  export interface NavigateOptions {
    /** Replace the current history entry instead of adding one. */
    replace?: boolean
  }
  /** Go to a page of the app by id: `navigate('logs')`. */
  export function navigate(pageId: string, options?: NavigateOptions): void

  export type NotifyType = 'default' | 'info' | 'success' | 'warning' | 'error'
  export interface NotifyOptions {
    type?: NotifyType
    description?: string
    /** Milliseconds on screen. */
    duration?: number
    /** A toast with the same id replaces the earlier one. */
    id?: string | number
    action?: { label: string; onClick: () => void }
  }
  /** Show a toast. Resolves to the toast id once the toaster has loaded. */
  export function notify(message: string, options?: NotifyOptions): Promise<string | number | undefined>

  export interface FetchJsonOptions extends Omit<RequestInit, 'body'> {
    /** A plain object or array is sent as JSON (method defaults to POST). */
    body?: unknown
  }
  /** What fetchJson() rejects with on a non-2xx or non-JSON response. */
  export interface FetchJsonError extends Error {
    status: number
    url: string
    body: unknown
  }
  /**
   * fetch() for the app's JSON APIs: sends the session's gateway token to
   * same-origin URLs, encodes a plain-object body, decodes the response and
   * rejects with a FetchJsonError on a non-2xx status.
   */
  export function fetchJson<T = unknown>(url: string, options?: FetchJsonOptions): Promise<T>

  /** React hook: the shell manifest (null only outside a running shell). */
  export function useManifest(): ShellManifest | null

  export interface ShellCommand {
    /** Unique id, by convention `<plugin>.<action>`. */
    id: string
    /** Label in the command palette. */
    title: string
    run: () => void | Promise<void>
    /** Palette section heading. Defaults to "Commands". */
    group?: string
    keywords?: readonly string[]
    icon?: ComponentType<{ className?: string }>
  }
  /** Add an entry to the command palette (Ctrl/Cmd+K). Returns a function that removes it. */
  export function registerCommand(command: ShellCommand): () => void

  export interface ActivateContext {
    readonly manifest: ShellManifest
  }
  /**
   * Run `hook` once the app is ready (immediately when it already is). Returns
   * a function that cancels a hook that has not run yet.
   */
  export function onActivate(hook: (context: ActivateContext) => void): () => void

  // ── default export ─────────────────────────────────────────────────

  /** The whole module as one object, for feature detection: `sdk.SDK_FEATURES?.includes(...)`. */
  const sdk: {
    readonly SDK_VERSION: number
    readonly SDK_FEATURES?: readonly string[]
    readonly [name: string]: unknown
  }
  export default sdk

  // Only what is marked `export` above is exported.
  export {}
}
