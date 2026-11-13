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
] as const
export type SdkFeature = (typeof SDK_FEATURES)[number]

export type ShellPageKind = 'native' | 'react' | 'blocks' | 'legacy' | 'iframe'

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
  source?: string
}

export type ShellPluginStatus = 'ok' | 'error' | 'disabled' | 'incompatible' | 'disabled-by-default'

export interface ShellManifest {
  sdk: number
  version: string
  style: string
  site: Record<string, unknown>
  layout: { sidebar?: unknown; pageHeader?: unknown }
  pages: ShellPage[]
  blocks: { type: string; module: string; integrity?: string; source: string }[]
  toolRenderers: { toolName: string; module: string; integrity?: string; source: string }[]
  plugins: { name: string; version?: string; status: ShellPluginStatus; error?: string }[]
  legacy: { customJs: string | null; viewsBase: string }
}

export const BOOT_ELEMENT_ID = 'aiui-boot'
export const MANIFEST_URL = '/api/shell/manifest'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function arrayOf<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
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
  return {
    sdk: typeof raw.sdk === 'number' ? raw.sdk : SDK_VERSION,
    version: typeof raw.version === 'string' ? raw.version : '',
    style: typeof raw.style === 'string' ? raw.style : 'app',
    site: isRecord(raw.site) ? raw.site : {},
    layout: isRecord(raw.layout) ? raw.layout : {},
    pages: arrayOf<ShellPage>(raw.pages).filter((p) => isRecord(p) && typeof p.id === 'string'),
    blocks: arrayOf(raw.blocks),
    toolRenderers: arrayOf(raw.toolRenderers),
    plugins: arrayOf(raw.plugins),
    legacy: {
      customJs: typeof legacy.customJs === 'string' ? legacy.customJs : null,
      viewsBase: typeof legacy.viewsBase === 'string' ? legacy.viewsBase : '/plugins/views/',
    },
  }
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
