/**
 * Imports the browser modules that entry-point plugins contribute through the
 * shell manifest (ADR-0001 §7, §8):
 *   - pages with kind 'react' (`page.module`, plus `page.css`)
 *   - `manifest.blocks[].module`
 *   - `manifest.toolRenderers[].module`
 *
 * Legacy-kind modules (dashboard-plugins folders, custom.js registerView) are
 * never imported here; the legacy runtime loads those.
 *
 * Each module is imported once (deduplicated by resolved URL). A module may
 * register itself through `@aiui/sdk` while it is evaluated, or default-export
 * a component (or name one with the spec's `export`), which is then
 * registered under the spec's page id / block type / tool name. A failure is
 * isolated to its module: it is reported with console.warn, a toast and an
 * `aiui:plugin-error` window event, and every other module still loads.
 *
 * installSdk() must have run first (modules import `@aiui/sdk`).
 */
import { notify } from '@/shell/notify'
import {
  getBlock,
  getPage,
  getToolRenderers,
  registerBlock,
  registerPage,
  registerToolRenderer,
  type AnyComponent,
} from './registry'
import type { ShellManifest } from './manifest'

export type PluginContributionKind = 'page' | 'block' | 'toolRenderer'

interface Contribution {
  kind: PluginContributionKind
  /** page id, block type or tool name */
  name: string
  exportName?: string
}

interface ModuleGroup {
  url: string
  source: string
  contributions: Contribution[]
}

export interface PluginLoadFailure {
  url: string
  /** Manifest `source`, e.g. `plugin:hello`. */
  source: string
  plugin: string
  message: string
  error?: unknown
}

export interface PluginLoadReport {
  /** Module URLs that were imported (or already imported) successfully. */
  loaded: string[]
  failed: PluginLoadFailure[]
  /** Contributions registered from a module's default/named export. */
  registered: { kind: PluginContributionKind; name: string; url: string }[]
}

export interface LoadPluginsOptions {
  /** Test seam; defaults to a native dynamic import(). */
  importModule?: (url: string) => Promise<unknown>
  /** Called once per failed module (after console.warn). Defaults to a toast. */
  onError?: (failure: PluginLoadFailure) => void
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

// URL -> import promise. The browser caches module records too; this also
// avoids re-registering when the manifest is loaded a second time.
const imported = new Map<string, Promise<unknown>>()
const stylesheets = new Set<string>()
let lastReport: PluginLoadReport | null = null

function nativeImport(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url)
}

function baseHref(): string {
  return typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://localhost/'
}

/** Absolute http(s) URL, or null for anything else (javascript:, data:, garbage). */
export function resolveModuleUrl(module: unknown): string | null {
  if (typeof module !== 'string' || !module.trim()) return null
  try {
    const url = new URL(module, baseHref())
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function pluginName(source: string | undefined): string {
  if (!source) return 'plugin'
  const i = source.indexOf(':')
  return i >= 0 ? source.slice(i + 1) || source : source
}

function isComponent(c: unknown): c is AnyComponent {
  return typeof c === 'function' || (typeof c === 'object' && c !== null && '$$typeof' in c)
}

function lookup(kind: PluginContributionKind, name: string): unknown {
  if (kind === 'page') return getPage(name)
  if (kind === 'block') return getBlock(name)
  return getToolRenderers()[name]
}

function register(kind: PluginContributionKind, name: string, c: AnyComponent): void {
  if (kind === 'page') registerPage(name, c)
  else if (kind === 'block') registerBlock(name, c)
  else registerToolRenderer(name, c)
}

function addStylesheet(href: string, integrity?: string): void {
  if (typeof document === 'undefined' || stylesheets.has(href)) return
  stylesheets.add(href)
  for (const el of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    if (el.href === href) return
  }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  // Same-origin /_plugins/ files are fetched in CORS mode so SRI can apply.
  link.crossOrigin = 'anonymous'
  if (integrity) link.integrity = integrity
  link.dataset.aiuiPlugin = 'true'
  link.addEventListener('error', () => {
    console.warn(`[aiui sdk] plugin stylesheet failed to load: ${href}`)
  })
  document.head.appendChild(link)
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  return String(err)
}

function defaultOnError(f: PluginLoadFailure): void {
  void notify(`Plugin "${f.plugin}" failed to load`, { type: 'error', description: f.message, id: `aiui-plugin:${f.url}` })
}

function report(failure: PluginLoadFailure, onError: (f: PluginLoadFailure) => void, out: PluginLoadReport) {
  out.failed.push(failure)
  console.warn(`[aiui sdk] ${failure.source || 'plugin'} module ${failure.url}: ${failure.message}`, failure.error ?? '')
  try {
    onError(failure)
  } catch (err) {
    console.warn('[aiui sdk] plugin error handler failed', err)
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('aiui:plugin-error', { detail: failure }))
  }
}

/** Group every importable contribution by its resolved module URL. */
function collect(m: ShellManifest, out: PluginLoadReport, onError: (f: PluginLoadFailure) => void) {
  const groups = new Map<string, ModuleGroup>()
  const add = (kind: PluginContributionKind, name: unknown, spec: Record<string, unknown>) => {
    const source = typeof spec.source === 'string' ? spec.source : ''
    if (typeof name !== 'string' || !name) return
    const url = resolveModuleUrl(spec.module)
    if (!url) {
      report(
        {
          url: String(spec.module ?? ''),
          source,
          plugin: pluginName(source),
          message: `${kind} '${name}' has no loadable module URL`,
        },
        onError,
        out,
      )
      return
    }
    let g = groups.get(url)
    if (!g) {
      g = { url, source, contributions: [] }
      groups.set(url, g)
    }
    const exportName = typeof spec.export === 'string' && spec.export ? spec.export : undefined
    g.contributions.push({ kind, name, exportName })
  }

  for (const page of m.pages) {
    if (page.kind !== 'react') continue // legacy/blocks/native/iframe are not imported here
    const spec = page as unknown as Record<string, unknown>
    add('page', page.id, spec)
    const css = resolveModuleUrl(page.css)
    if (css) {
      const cssIntegrity = typeof spec.cssIntegrity === 'string' ? spec.cssIntegrity : undefined
      addStylesheet(css, cssIntegrity)
    }
  }
  for (const b of m.blocks) add('block', b.type, b as unknown as Record<string, unknown>)
  for (const t of m.toolRenderers) add('toolRenderer', t.toolName, t as unknown as Record<string, unknown>)
  return [...groups.values()]
}

async function loadGroup(
  g: ModuleGroup,
  importModule: (url: string) => Promise<unknown>,
  onError: (f: PluginLoadFailure) => void,
  out: PluginLoadReport,
) {
  const plugin = pluginName(g.source)
  // Snapshot before evaluation so a self-registration during import is seen
  // as such (and not overwritten by the default export).
  const before = g.contributions.map((c) => lookup(c.kind, c.name))
  let mod: unknown
  let p = imported.get(g.url)
  const firstImport = !p
  try {
    if (!p) {
      p = importModule(g.url)
      imported.set(g.url, p)
      // A failed import may be retried by a later loadManifestPlugins() call.
      p.catch(() => imported.delete(g.url))
    }
    mod = await p
  } catch (error) {
    report({ url: g.url, source: g.source, plugin, message: describe(error), error }, onError, out)
    return
  }
  out.loaded.push(g.url)

  const missing: string[] = []
  g.contributions.forEach((c, i) => {
    const now = lookup(c.kind, c.name)
    // Registered itself via @aiui/sdk while evaluating; or, for a module that
    // was imported by an earlier call, already registered back then.
    if (now !== undefined && (now !== before[i] || !firstImport)) return
    const exported =
      typeof mod === 'object' && mod !== null ? (mod as Record<string, unknown>)[c.exportName ?? 'default'] : undefined
    if (isComponent(exported)) {
      try {
        register(c.kind, c.name, exported)
        out.registered.push({ kind: c.kind, name: c.name, url: g.url })
      } catch (error) {
        missing.push(`${c.kind} '${c.name}': ${describe(error)}`)
      }
      return
    }
    missing.push(`${c.kind} '${c.name}' was not registered and the module has no ${c.exportName ?? 'default'} component export`)
  })
  if (missing.length) {
    report({ url: g.url, source: g.source, plugin, message: missing.join('; ') }, onError, out)
  }
}

/**
 * Import every plugin module listed in the manifest. Never rejects: failures
 * are isolated per module and returned in the report.
 */
export async function loadPluginModules(
  manifest: ShellManifest,
  opts: LoadPluginsOptions = {},
): Promise<PluginLoadReport> {
  const out: PluginLoadReport = { loaded: [], failed: [], registered: [] }
  const onError = opts.onError ?? defaultOnError
  const importModule = opts.importModule ?? nativeImport
  let groups: ModuleGroup[]
  try {
    groups = collect(manifest, out, onError)
  } catch (error) {
    report({ url: '', source: '', plugin: 'plugin', message: describe(error), error }, onError, out)
    return out
  }
  await Promise.all(groups.map((g) => loadGroup(g, importModule, onError, out)))
  lastReport = out
  return out
}

/**
 * The shell's entry point (frozen contract, ADR-0001 §5): import the plugin
 * modules of `manifest`. Never rejects; see getLastPluginLoadReport().
 */
export async function loadManifestPlugins(manifest: ShellManifest): Promise<void> {
  await loadPluginModules(manifest)
}

/** What the most recent load imported, registered and failed (diagnostics). */
export function getLastPluginLoadReport(): PluginLoadReport | null {
  return lastReport
}

/** Test helper: forget imported modules and injected stylesheets. */
export function resetPluginLoaderForTests(): void {
  imported.clear()
  stylesheets.clear()
  lastReport = null
}
