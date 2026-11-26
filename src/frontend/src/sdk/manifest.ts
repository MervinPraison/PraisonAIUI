/**
 * Shell manifest contract (ADR-0001 §5). Mirrors the server's
 * `_build_shell_manifest()` served inline as `<script id="aiui-boot">` and at
 * `GET /api/shell/manifest`.
 *
 * FROZEN CONTRACT: change only additively, and keep the server in sync.
 *
 * This module must stay free of runtime imports: scripts/gen-externals.mjs
 * transpiles it on its own to read SDK_EXPORTS at build time.
 */

/** Major version of the browser plugin SDK (`window.__AIUI_SDK__.version`). */
export const SDK_VERSION = 1

/**
 * Bare specifiers a plugin ESM bundle may import. The server's import map
 * points each one at an `/_aiui/externals/*.js` shim that re-exports the
 * shell's own instance from `window.__AIUI_SDK__.modules[specifier]`.
 */
export const SHELL_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@aiui/sdk',
] as const
export type ShellExternal = (typeof SHELL_EXTERNALS)[number]

/**
 * The frozen named-export list of the `@aiui/sdk` module. The object installed
 * at `window.__AIUI_SDK__.modules['@aiui/sdk']` (WP7, sdk/install.ts) must have
 * exactly these keys, and the server's ESM shim re-exports exactly these names
 * (read from dist/aiui-externals.json, generated from this list).
 */
export const SDK_EXPORTS = [
  'SDK_VERSION',
  'registerPage',
  'registerBlock',
  'registerSlot',
  'registerToolRenderer',
  'registerView',
  'getPage',
  'getBlock',
  'getSlot',
  'getToolRenderers',
  'subscribe',
  'useRegistryVersion',
  'Markdown',
  // Shell services (additive, SDK_VERSION stays 1; see SDK_FEATURES).
  'SDK_FEATURES',
  'navigate',
  'notify',
  'fetchJson',
  'useManifest',
  'registerCommand',
  'onActivate',
  // Current page and colour mode (additive; see the page-id and theme-mode features).
  'getPageId',
  'usePageId',
  'useThemeMode',
  // Close a toast raised with notify() (feature notify.dismiss).
  'dismiss',
  // Shell contributions (features settings, nav-groups, theme-presets).
  'registerSettingsSection',
  'registerNavGroup',
  'registerThemePreset',
  // Selectable layouts (features layouts and layout-data; ADR 0003).
  'registerLayout',
  'getLayouts',
  'useLayout',
  'setLayout',
  'provideLayoutData',
  'useLayoutData',
] as const
export type SdkExportName = (typeof SDK_EXPORTS)[number]

/**
 * Capabilities of this SDK build, exported as `SDK_FEATURES`. The SDK grows
 * additively under one major version, so a plugin that must also run on an
 * older shell asks before it uses a newer export:
 *
 *   import sdk from '@aiui/sdk'
 *   if (sdk.SDK_FEATURES?.includes('commands')) sdk.registerCommand({...})
 *
 * (`SDK_FEATURES` itself is missing on shells older than the services, hence
 * the `?.`; a named import of an export the shell lacks fails at link time.)
 * Only ever append to this list.
 */
export const SDK_FEATURES = [
  'pages',
  'blocks',
  'tool-renderers',
  'slots',
  'views',
  'markdown',
  'navigate',
  'notify',
  'fetch-json',
  'manifest',
  'commands',
  'activate',
  // registerSlot(slot, C, { id, order }) and the shell's slot hosts
  'slots.multi',
  // registerBlock(type, C, { fallback: true })
  'blocks.fallback',
  // getPageId() / usePageId(): the current page, read like the shell's router
  'page-id',
  // useThemeMode(): 'light' | 'dark'
  'theme-mode',
  // dismiss(id): close a toast raised with notify({ id })
  'notify.dismiss',
  // registerSettingsSection() and a plugin record's `settings` (Python settings())
  'settings',
  // registerNavGroup() and a plugin record's `navGroups` (Python nav_groups())
  'nav-groups',
  // registerThemePreset() and a plugin record's `themes` (Python themes())
  'theme-presets',
  // registerLayout / getLayouts / useLayout / setLayout and manifest.layouts (ADR 0003)
  'layouts',
  // provideLayoutData() / useLayoutData(): the feeds a layout frame reads
  'layout-data',
  // registerSlot() returns a disposer
  'slots.dispose',
] as const
export type SdkFeature = (typeof SDK_FEATURES)[number]

export type ShellPageKind = 'native' | 'react' | 'blocks' | 'legacy' | 'iframe'

export interface ShellPage {
  id: string
  title: string
  kind: ShellPageKind
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
  source?: string
  /**
   * Layout-owned page (ADR 0003): the nav lists it only while one of these
   * layouts is active. Its URL renders under any layout.
   */
  layouts?: string[]
  /** While a layout listing this page is active, this page stands in for the page with that id. */
  replaces?: string
  /** Presentation family of the page (list-detail, board, log, editor, gallery…); styling only. */
  pageType?: string
  /** Optional short badge or count shown beside the page title in the sidebar. */
  badge?: string
}

/**
 * Layout ids: lower-case, digits and dashes, starting with a letter, at most
 * 40 characters. Same rule as the server (`schema/models.py` LayoutConfig).
 */
export const LAYOUT_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/

/** Reserved id meaning the core's own frame (no layout). Never registered. */
export const CLASSIC_LAYOUT_ID = 'classic'

/** One selectable layout the server offers (manifest `layouts.available`). */
export interface ShellLayoutSpec {
  id: string
  title: string
  description?: string
  order?: number
  /** Who provides it: `builtin`, `plugin:<name>`. */
  source: string
  /** ESM URL of a plugin layout, imported only when the layout is active. */
  module?: string
  css?: string
  integrity?: string
  /** SRI of `css` (a plugin layout's stylesheet), set on its `<link>`. */
  cssIntegrity?: string
  /** The page `/` opens while this layout is active (`layout.defaultPage` still wins). */
  home?: string
  /** Page ids for the layout's primary nav, in order (YAML `layout.primary` wins). */
  primary?: string[]
  /** Per-layout options from YAML `layout.options.<id>`. */
  options?: Record<string, unknown>
}

/**
 * Manifest `layouts`. Absent (an older server) or with no `available`
 * entries means the classic frame.
 */
export interface ShellLayouts {
  /** The server default: a layout id, or '' for the classic frame. */
  default: string
  /** Whether a viewer's own choice (stored in the browser) may override `default`. */
  userChoice: boolean
  available: ShellLayoutSpec[]
}

export type ShellPluginStatus = 'ok' | 'error' | 'disabled' | 'incompatible' | 'disabled-by-default'

/** Where a plugin record comes from (server PluginRecord.origin). */
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
  /** The plugin's settings() sections (only on records with status `ok`). */
  settings?: ShellSettingsSection[]
  /** The plugin's nav_groups(). */
  navGroups?: { name: string; order?: number | null; folded?: boolean }[]
  /** The plugin's themes(): seed tokens per mode. */
  themes?: { id: string; label: string; light?: Record<string, string>; dark?: Record<string, string> }[]
}

export interface ShellSettingsField {
  key: string
  label?: string
  type?: 'string' | 'text' | 'number' | 'boolean' | 'select'
  default?: string | number | boolean
  description?: string
  options?: { value: string; label?: string }[]
}

export interface ShellSettingsSection {
  id: string
  title: string
  description?: string
  order?: number
  fields: ShellSettingsField[]
  /** GET → `{values}`, PUT `{values}` → `{values}` (or 400 `{error, fields}`). */
  endpoint: string
}

export interface ShellManifest {
  sdk: number
  version: string
  style: string
  site: Record<string, unknown>
  layout: {
    sidebar?: unknown
    pageHeader?: unknown
    /**
     * Sidebar group order, the group pinned last, the groups that start
     * folded, and the groups every layout lists like a declared group
     * (`shown`: the app's own pages, or all of them under `set_pages("all")`).
     */
    groups?: { order?: string[]; last?: string; folded?: string[]; shown?: string[] }
  }
  pages: ShellPage[]
  blocks: { type: string; module: string; integrity?: string; source: string }[]
  toolRenderers: { toolName: string; module: string; integrity?: string; source: string }[]
  plugins: ShellPluginRecord[]
  legacy: { customJs: string | null; viewsBase: string }
  /** Selectable layouts (ADR 0003). Not to be confused with `layout`, the sidebar and page settings. */
  layouts?: ShellLayouts
}

export const BOOT_ELEMENT_ID = 'aiui-boot'
export const MANIFEST_URL = '/api/shell/manifest'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function arrayOf<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** Is `id` a layout id a layout can be registered under ('classic' is reserved)? */
export function isLayoutId(id: unknown): id is string {
  return typeof id === 'string' && LAYOUT_ID_PATTERN.test(id) && id !== CLASSIC_LAYOUT_ID
}

/** Drop the layout fields of a page when they have the wrong type; the page is otherwise untouched. */
function normalizePage(p: ShellPage): ShellPage {
  const bad = {
    layouts: p.layouts !== undefined && !isStringList(p.layouts),
    replaces: p.replaces !== undefined && typeof p.replaces !== 'string',
    pageType: p.pageType !== undefined && typeof p.pageType !== 'string',
    badge: p.badge !== undefined && typeof p.badge !== 'string',
  }
  if (!bad.layouts && !bad.replaces && !bad.pageType && !bad.badge) return p
  const out = { ...p }
  for (const key of Object.keys(bad) as (keyof typeof bad)[]) if (bad[key]) delete out[key]
  return out
}

function normalizeLayoutSpec(v: unknown): ShellLayoutSpec | null {
  if (!isRecord(v) || !isLayoutId(v.id)) return null
  const spec: ShellLayoutSpec = {
    id: v.id,
    title: typeof v.title === 'string' && v.title ? v.title : v.id,
    source: typeof v.source === 'string' && v.source ? v.source : 'builtin',
  }
  for (const key of ['description', 'module', 'css', 'integrity', 'cssIntegrity', 'home'] as const) {
    const value = v[key]
    if (typeof value === 'string') spec[key] = value
  }
  if (typeof v.order === 'number' && Number.isFinite(v.order)) spec.order = v.order
  if (isStringList(v.primary)) spec.primary = v.primary
  if (isRecord(v.options)) spec.options = v.options
  return spec
}

/**
 * Manifest `layouts`, or undefined when the server sent none (classic).
 * Entries without a valid id are dropped, a repeated id keeps its first
 * entry, and a `default` that is not a layout id (or is `classic`) becomes ''.
 */
function normalizeLayouts(raw: unknown): ShellLayouts | undefined {
  if (!isRecord(raw)) return undefined
  const seen = new Set<string>()
  const available: ShellLayoutSpec[] = []
  for (const item of arrayOf(raw.available)) {
    const spec = normalizeLayoutSpec(item)
    if (!spec || seen.has(spec.id)) continue
    seen.add(spec.id)
    available.push(spec)
  }
  return {
    default: isLayoutId(raw.default) ? raw.default : '',
    userChoice: raw.userChoice !== false,
    available,
  }
}

/**
 * Fill every optional collection with a safe default so consumers can iterate
 * without guards. Returns null when `raw` is not a full manifest (no `pages`
 * array), e.g. the minimal `{sdk, version, style}` copy the server inlines
 * when auth is enforced.
 */
export function normalizeManifest(raw: unknown): ShellManifest | null {
  if (!isRecord(raw) || !Array.isArray(raw.pages)) return null
  const legacy = isRecord(raw.legacy) ? raw.legacy : {}
  const manifest: ShellManifest = {
    sdk: typeof raw.sdk === 'number' ? raw.sdk : SDK_VERSION,
    version: typeof raw.version === 'string' ? raw.version : '',
    style: typeof raw.style === 'string' ? raw.style : 'app',
    site: isRecord(raw.site) ? raw.site : {},
    layout: isRecord(raw.layout) ? raw.layout : {},
    pages: arrayOf<ShellPage>(raw.pages)
      .filter((p) => isRecord(p) && typeof p.id === 'string')
      .map(normalizePage),
    blocks: arrayOf(raw.blocks),
    toolRenderers: arrayOf(raw.toolRenderers),
    plugins: arrayOf(raw.plugins),
    legacy: {
      customJs: typeof legacy.customJs === 'string' ? legacy.customJs : null,
      viewsBase: typeof legacy.viewsBase === 'string' ? legacy.viewsBase : '/plugins/views/',
    },
  }
  const layouts = normalizeLayouts(raw.layouts)
  if (layouts) manifest.layouts = layouts
  return manifest
}

/**
 * Read the manifest the server inlined as `<script id="aiui-boot"
 * type="application/json">`. Returns null when it is missing, unparseable or
 * partial (auth-enforced servers inline only `{sdk, version, style}`); the
 * shell then calls fetchManifest().
 */
export function readBootManifest(): ShellManifest | null {
  if (typeof document === 'undefined') return null
  const el = document.getElementById(BOOT_ELEMENT_ID)
  if (!el?.textContent) return null
  try {
    return normalizeManifest(JSON.parse(el.textContent))
  } catch {
    return null
  }
}

/**
 * GET /api/shell/manifest. `fetchImpl` lets the shell pass its auth-aware
 * fetch. Rejects on a non-2xx response or a body that is not a manifest.
 */
export async function fetchManifest(fetchImpl: typeof fetch = fetch): Promise<ShellManifest> {
  const res = await fetchImpl(MANIFEST_URL, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`GET ${MANIFEST_URL} failed: ${res.status}`)
  const m = normalizeManifest(await res.json())
  if (!m) throw new Error(`GET ${MANIFEST_URL} returned an invalid manifest`)
  return m
}

declare global {
  interface Window {
    /** Cache-bust string of the running build (style `app`; set inline by the server). */
    __AIUI_BUILD__?: string
  }
}
