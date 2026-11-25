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
    /** An emoji or a lucide icon name (`bot`, `chart-column`, …). */
    icon?: string
    /** A lucide icon name for the shell's sidebar, preferred over `icon` (built-in pages set it). */
    navIcon?: string
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
    /** Layout-owned page: listed in the nav only while one of these layouts is active. */
    layouts?: string[]
    /** While such a layout is active, this page stands in for the page with this id. */
    replaces?: string
    /** Presentation family (list-detail, board, log, editor, gallery…). */
    pageType?: string
  }

  /** One selectable layout the server offers (manifest `layouts.available`). */
  export interface ShellLayoutSpec {
    id: string
    title: string
    description?: string
    order?: number
    /** `builtin`, `plugin:<name>`. */
    source: string
    /** ESM URL of a plugin layout, imported only when it is active. */
    module?: string
    css?: string
    integrity?: string
    /** The page `/` opens while this layout is active. */
    home?: string
    /** Page ids of the primary nav, in order. */
    primary?: string[]
    /** YAML `layout.options.<id>`. */
    options?: Record<string, unknown>
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
    /** The plugin's Python settings() sections (records with status `ok` only). */
    settings?: {
      id: string
      title: string
      description?: string
      order?: number
      fields: SettingsField[]
      /** GET → `{values}`; PUT `{values}` → `{values}` or 400 `{error, fields}`. */
      endpoint: string
    }[]
    /** The plugin's Python nav_groups(). */
    navGroups?: { name: string; order?: number | null; folded?: boolean }[]
    /** The plugin's Python themes(). */
    themes?: ThemePresetInput[]
  }

  /** GET /api/shell/manifest. */
  export interface ShellManifest {
    sdk: number
    version: string
    style: string
    site: Record<string, unknown>
    layout: {
      sidebar?: unknown
      pageHeader?: unknown
      /** Sidebar group order, the group pinned last, and the groups that start folded. */
      groups?: { order?: string[]; last?: string; folded?: string[] }
    }
    pages: ShellPage[]
    blocks: { type: string; module: string; integrity?: string; source: string }[]
    toolRenderers: { toolName: string; module: string; integrity?: string; source: string }[]
    plugins: ShellPluginRecord[]
    legacy: { customJs: string | null; viewsBase: string }
    /** Selectable layouts; absent on older servers (classic frame). Feature `'layouts'`. */
    layouts?: {
      /** A layout id, or '' for the classic frame. */
      default: string
      /** Whether the viewer's own choice may override `default`. */
      userChoice: boolean
      available: ShellLayoutSpec[]
    }
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
   *
   * Returns a disposer that removes this contribution, and nothing once a
   * later call replaced it (feature `slots.dispose`; older shells return
   * undefined).
   */
  export function registerSlot(slot: string, component: AnyComponent, options?: SlotOptions): () => void
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
  /** Close the toast with this id (all toasts without one). Feature `'notify.dismiss'`. */
  export function dismiss(id?: string | number): Promise<void>

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

  /**
   * The id of the page on screen ('' at `/`), read the way the shell's router
   * reads the URL. Feature `'page-id'`.
   */
  export function getPageId(): string
  /** React hook: the current page id; re-renders on navigation. Feature `'page-id'`. */
  export function usePageId(): string

  export type ThemeMode = 'light' | 'dark'
  /** React hook: the colour mode in effect, updated when it changes. Feature `'theme-mode'`. */
  export function useThemeMode(): ThemeMode

  // ── shell contributions (features 'settings', 'nav-groups', 'theme-presets') ──

  export type SettingsFieldType = 'string' | 'text' | 'number' | 'boolean' | 'select'
  export type SettingsValue = string | number | boolean
  export type SettingsValues = Record<string, SettingsValue>
  export interface SettingsField {
    /** Value key, `[A-Za-z_][A-Za-z0-9_]*`. */
    key: string
    label?: string
    /** Default `'string'`. */
    type?: SettingsFieldType
    /** Default `''`, `0`, `false` or the first option. */
    default?: SettingsValue
    description?: string
    /** `select` only. */
    options?: readonly (string | { value: string; label?: string })[]
  }
  export interface SettingsSectionInput {
    /** Unique id, by convention `<plugin>.<section>`. */
    id: string
    title: string
    description?: string
    /** Lower comes first. Default 100. */
    order?: number
    fields: readonly SettingsField[]
    load(): Promise<SettingsValues>
    /** Reject with an error whose `body.fields` maps keys to reasons to show them inline. */
    save(values: SettingsValues): Promise<SettingsValues | void>
  }
  /** Add a section to the shell's settings dialog. Returns a remover. Feature `'settings'`. */
  export function registerSettingsSection(section: SettingsSectionInput): () => void

  export interface NavGroupOptions {
    /** Among the groups: `layout.groups.order` sits at 100, 200, 300…; unordered groups follow. */
    order?: number
    /** Start collapsed. */
    folded?: boolean
  }
  /** Declare the sidebar group your pages use. The app's `layout.groups` wins. Feature `'nav-groups'`. */
  export function registerNavGroup(name: string, options?: NavGroupOptions): () => void

  export interface ThemePresetInput {
    /** Unique id, by convention `<plugin>.<name>`. */
    id: string
    label: string
    /** Seed tokens (`--seed-*`, `--radius`, `--tint-mix`, `--accent-mix`) for light mode. */
    light?: Readonly<Record<string, string>>
    dark?: Readonly<Record<string, string>>
  }
  /** Offer a theme preset the viewer can pick in the command palette. Feature `'theme-presets'`. */
  export function registerThemePreset(preset: ThemePresetInput): () => void

  // ── layouts (features 'layouts', 'layout-data'; ADR 0003) ───────────

  /** Width < 768 px, < 1024 px, else desktop. */
  export type LayoutViewport = 'phone' | 'tablet' | 'desktop'
  export interface ChatRegionProps {
    sessionId: string | null
    viewport: LayoutViewport
    /** Show a count on the region's phone tab (0 hides it). */
    reportBadge(n: number): void
  }
  export interface TurnRegionProps extends ChatRegionProps {
    messageId: string
  }
  export type RegionLoader<P = ChatRegionProps> = () => Promise<{ default: ComponentType<P> }>
  /** How the chat page presents itself inside the layout. */
  export interface ChatPresentation {
    /** Who draws the session list. Default `'page'`. */
    sessions?: 'page' | 'frame' | 'tabs' | 'none'
    thread?: 'bubbles' | 'quiet' | 'steps' | 'dense'
    approvals?: 'inline' | 'card' | 'keyboard'
    /** Desktop right panel; on a phone, a second tab labelled `asideLabel`. */
    aside?: RegionLoader
    asideLabel?: string
    turnHeader?: RegionLoader<TurnRegionProps>
    turnFooter?: RegionLoader<TurnRegionProps>
    /** Shown in an empty thread. */
    empty?: RegionLoader
    /** In the composer next to attach; the region portals its control into the composer row. */
    composerTool?: RegionLoader
  }
  export interface LayoutMeta {
    title: string
    description?: string
    /** Picker thumbnail URL. */
    preview?: string
    chat?: ChatPresentation
    /** `'frame'`: approval toasts stop and the layout shows them. Default `'toast'`. */
    approvals?: 'toast' | 'frame'
    /** A look of the Pro tokens this layout paints with (`<html data-aiui-look>`), unless the viewer chose plain Pro. */
    look?: string
  }
  export interface LayoutNavItem {
    id: string
    title: string
    navIcon?: string
    icon?: string
    group: string
    href: string
    active: boolean
    badge?: number
  }
  export interface LayoutNav {
    /** At most 7 items. */
    primary: readonly LayoutNavItem[]
    /** Every other page, by sidebar group. */
    groups: readonly { name: string; folded: boolean; items: readonly LayoutNavItem[] }[]
    footer: readonly LayoutNavItem[]
    activeId: string
    go(pageId: string): void
  }
  export interface LayoutChrome {
    siteTitle: string
    siteLogo: { kind: 'img' | 'text'; value: string } | null
    /** Open the command palette, optionally with a query typed in. */
    openPalette(options?: { query?: string }): void
    toggleColorMode(): void
    /** The shell's slot host. */
    Slot: ComponentType<{ name: string; className?: string }>
    /** Id of the main landmark (skip-link target). */
    mainId: string
  }
  /** Props of a layout frame. */
  export interface LayoutProps {
    /** The routed page, with its error boundary, toolbar slot and Suspense. */
    Outlet: ComponentType<{ className?: string }>
    pageId: string
    page?: ShellPage
    fullBleed: boolean
    nav: LayoutNav
    chrome: LayoutChrome
    viewport: LayoutViewport
    layout: { id: string; available: readonly ShellLayoutSpec[]; switchTo(id: string): void }
  }
  export type LayoutComponent = ComponentType<LayoutProps>
  export type LayoutLoader = () => Promise<{ default: LayoutComponent }>
  export interface LayoutInfo {
    readonly id: string
    readonly meta: LayoutMeta
  }
  /**
   * Register a layout frame: a component, or a loader returning `import()`
   * that runs only when the layout is first shown. Ids are `[a-z][a-z0-9-]*`
   * (`classic` is reserved). The server's manifest decides which registered
   * layouts are offered. Returns a remover.
   */
  export function registerLayout(id: string, meta: LayoutMeta, component: LayoutComponent | LayoutLoader): () => void
  /** Registered layouts, in registration order. */
  export function getLayouts(): readonly LayoutInfo[]
  /** React hook: the active layout, or null for the classic frame. */
  export function useLayout(): LayoutInfo | null
  /**
   * Switch layouts live (`''` or `'classic'`: the classic frame). Remembered in
   * this browser unless `{ persist: false }` (this tab only).
   */
  export function setLayout(id: string, options?: { persist?: boolean }): void

  /** A changing value, ready for `useSyncExternalStore(feed.subscribe, feed.get)`. */
  export interface Feed<S> {
    get(): S
    subscribe(listener: () => void): () => void
  }
  export interface SessionSummary {
    id: string
    title: string
    untitled?: boolean
    agent?: string
    platform?: string
    /** Epoch ms. */
    updatedAt?: number
  }
  export interface SessionsState {
    sessions: readonly SessionSummary[]
    activeId: string | null
    runningIds: ReadonlySet<string>
    loading: boolean
    error?: string
  }
  export interface SessionsFeed extends Feed<SessionsState> {
    select(id: string | null): void
    create(): void
    rename(id: string, title: string): Promise<void>
    remove(id: string): Promise<void>
    refresh(): Promise<void>
  }
  export interface ChatTiming {
    startedAt: number
    completedAt?: number
  }
  export type ChatPartView =
    | { type: 'text'; id: string; text: string }
    | { type: 'reasoning'; id: string; text: string; done: boolean; timing?: ChatTiming }
    | {
        type: 'tool-call'
        id: string
        toolName: string
        args: Readonly<Record<string, unknown>>
        result?: unknown
        isError?: boolean
        artifact: Readonly<Record<string, unknown>>
        timing?: ChatTiming
        approval?: {
          id: string
          prompt?: string
          display?: 'decision' | 'select' | 'text'
          allowFreeform?: boolean
          options?: readonly { id: string; kind: string; label?: string }[]
          approved?: boolean
          optionId?: string
          text?: string
        }
      }
    | { type: 'data'; id: string; name: string; data: unknown }
  export type ChatMessageStatus =
    | { type: 'running' }
    | { type: 'requires-action'; reason: 'interrupt' | 'tool-calls' }
    | { type: 'complete' }
    | { type: 'incomplete'; reason: 'cancelled' | 'error'; error?: string }
  export interface ChatMessageView {
    id: string
    role: 'user' | 'assistant' | 'system'
    parts: readonly ChatPartView[]
    createdAt: number
    completedAt?: number
    status?: ChatMessageStatus
    runId?: string
    agentName?: string
    custom?: Readonly<Record<string, unknown>>
  }
  export interface ChatState {
    sessionId: string | null
    messages: readonly ChatMessageView[]
    isRunning: boolean
    activeRunId?: string
    connection?: 'connecting' | 'open' | 'closed'
  }
  export interface ChatFeed extends Feed<ChatState> {
    prefill(text: string): void
    send?(text: string, options?: { agentName?: string }): Promise<void>
    cancel(): Promise<void>
    resolveApproval(
      approvalId: string,
      approved: boolean,
      options?: { text?: string; optionId?: string; always?: boolean },
    ): Promise<void>
  }
  export interface ApprovalItem {
    id: string
    toolName?: string
    agentName?: string
    sessionId?: string
    riskLevel?: string
    description?: string
    args?: Readonly<Record<string, unknown>>
    createdAt?: number
  }
  export interface ApprovalsFeed extends Feed<{ pending: readonly ApprovalItem[] }> {
    approve(id: string, options?: { always?: boolean }): Promise<void>
    deny(id: string, reason?: string): Promise<void>
  }
  export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  export interface RunSummary {
    id: string
    sessionId?: string
    agent?: string
    startedAt: number
    endedAt?: number
    status: RunStatus
    stepCount?: number
    tokens?: number
    /** US dollars. */
    cost?: number
    /** Tokens and cost joined by time window rather than run id. */
    approximate?: boolean
  }
  export interface RunStep {
    id: string
    kind: 'reasoning' | 'tool' | 'text' | 'approval' | 'handoff'
    label: string
    startedAt?: number
    endedAt?: number
    status?: 'running' | 'done' | 'error' | 'waiting'
    toolName?: string
  }
  export interface RunDetail extends RunSummary {
    steps: readonly RunStep[]
    model?: string
    tokensIn?: number
    tokensOut?: number
  }
  export interface RunQuery {
    after?: string
    agent?: string
    limit?: number
  }
  export interface RunKpis {
    window: 'today' | '24h' | '7d'
    runs: number
    runsDelta?: number
    successRate?: number
    cost?: number
    budget?: number
    p50Ms?: number
    p95Ms?: number
  }
  export interface AgentStatus {
    name: string
    state: 'running' | 'waiting' | 'idle'
    elapsedMs?: number
    lastRunAt?: number
    model?: string
    tokensToday?: number
    costToday?: number
  }
  export interface RunsFeed {
    run(runId: string): Feed<RunDetail | null>
    recent(query?: RunQuery): Feed<readonly RunSummary[]>
    kpis(window: 'today' | '24h' | '7d'): Feed<RunKpis | null>
    agents(): Feed<readonly AgentStatus[]>
  }
  export type ArtifactKind = 'code' | 'table' | 'markdown' | 'file' | 'image' | 'pdf' | 'video' | 'a2ui' | 'whiteboard' | 'sheet'
  export interface Artifact {
    key: string
    kind: ArtifactKind
    title: string
    version: number
    sessionId: string | null
    messageId: string
    language?: string
    content?: string
    url?: string
    mimeType?: string
    updatedAt?: number
    edited?: boolean
  }
  export interface ArtifactsFeed {
    forSession(sessionId: string | null): Feed<readonly Artifact[]>
    open(sessionId: string, key: string, version?: number): void
  }
  /**
   * Data kinds and their feeds. Add your own by declaration merging:
   * `declare module '@aiui/sdk' { interface LayoutDataMap { weather: WeatherFeed } }`.
   */
  export interface LayoutDataMap {
    sessions: SessionsFeed
    chat: ChatFeed
    approvals: ApprovalsFeed
    runs: RunsFeed
    artifacts: ArtifactsFeed
  }
  /**
   * Provide the feed of a data kind, or a loader of it (a function is always
   * a loader) that runs the first time a frame reads the kind. Returns a remover.
   */
  export function provideLayoutData<K extends keyof LayoutDataMap>(
    kind: K,
    provider: LayoutDataMap[K] | (() => Promise<LayoutDataMap[K]>),
  ): () => void
  /** React hook: the feed, or null while nothing provides it or it is loading. */
  export function useLayoutData<K extends keyof LayoutDataMap>(kind: K): LayoutDataMap[K] | null

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
