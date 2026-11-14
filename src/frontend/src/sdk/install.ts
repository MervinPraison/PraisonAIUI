/**
 * Browser plugin SDK (ADR-0001 §7, §8).
 *
 * installSdk() publishes `window.__AIUI_SDK__` BEFORE any plugin module is
 * imported. Plugin ESM bundles import React and the SDK as bare specifiers
 * ('react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@aiui/sdk');
 * the server's import map points each one at an `/_aiui/externals/*.js` shim
 * that re-exports `window.__AIUI_SDK__.modules[specifier]`. Plugins therefore
 * share the shell's single React instance (hooks work, no duplicate React).
 *
 * The `@aiui/sdk` module object has exactly the keys of SDK_EXPORTS
 * (sdk/manifest.ts), the frozen list the server shim re-exports. Its types
 * for plugin authors are in sdk/aiui-sdk.d.ts.
 *
 * The SDK is the core's public face: it must not import the shell
 * (shell/core-purity.test.ts). The shell provides its services through
 * sdk/services.ts instead.
 */
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import { Markdown } from '@/markdown/LazyMarkdown'
import {
  getBlock,
  getPage,
  getSlot,
  getToolRenderers,
  registerBlock,
  registerPage,
  registerSlot,
  registerToolRenderer,
  subscribe,
  useRegistryVersion,
} from './registry'
import { SDK_FEATURES, SDK_VERSION, type SdkExportName, type ShellExternal } from './manifest'
import { notify } from './notify'
import { fetchJson, navigate, onActivate, registerCommand, useManifest } from './services'

export { getLastPluginLoadReport, loadManifestPlugins } from './loadPlugins'
export type { PluginLoadFailure, PluginLoadReport, LoadPluginsOptions } from './loadPlugins'

/** A legacy view: render into a container, optionally return a cleanup. */
export type LegacyViewRender = (container: HTMLElement) => unknown
export type LegacyViewCleanup = () => void

interface LegacyAiuiGlobal {
  registerView?: (pageId: string, render: LegacyViewRender, cleanup?: LegacyViewCleanup) => void
  __queue?: [string, ArrayLike<unknown>][]
}

/**
 * Register a vanilla (legacy-kind) view, exactly like custom.js
 * `window.aiui.registerView`. It forwards to the legacy runtime once that
 * exists; before that the call is queued on `window.aiui.__queue`, which the
 * legacy runtime replays when it loads (the same queue the server's custom.js
 * stub uses).
 */
export function registerView(pageId: string, render: LegacyViewRender, cleanup?: LegacyViewCleanup): void {
  if (typeof pageId !== 'string' || !pageId) {
    throw new TypeError(`[aiui sdk] registerView: expected a non-empty string id, got ${String(pageId)}`)
  }
  if (typeof render !== 'function') {
    throw new TypeError(`[aiui sdk] registerView('${pageId}'): expected a render function`)
  }
  if (typeof window === 'undefined') return
  const w = window as unknown as { aiui?: LegacyAiuiGlobal }
  const aiui = (w.aiui ??= {})
  // Either the real legacy registry or the server's queue stub: both are right.
  if (typeof aiui.registerView === 'function') {
    aiui.registerView(pageId, render, cleanup)
    return
  }
  ;(aiui.__queue ??= []).push(['registerView', cleanup ? [pageId, render, cleanup] : [pageId, render]])
}

/**
 * The `@aiui/sdk` module. Its keys must equal SDK_EXPORTS (enforced at compile
 * time by `satisfies`, and at test time by sdk.test.tsx).
 */
export const sdkApi = Object.freeze({
  SDK_VERSION,
  registerPage,
  registerBlock,
  registerSlot,
  registerToolRenderer,
  registerView,
  getPage,
  getBlock,
  getSlot,
  getToolRenderers,
  subscribe,
  useRegistryVersion,
  Markdown,
  SDK_FEATURES,
  navigate,
  notify,
  fetchJson,
  useManifest,
  registerCommand,
  onActivate,
} satisfies { [K in SdkExportName]: unknown })

// Compile-time check that the published typings (./aiui-sdk.d.ts, the types a
// plugin author gets for `@aiui/sdk`) describe this object.
sdkApi satisfies Omit<typeof import('@aiui/sdk'), 'default'>

type ModuleObject = Readonly<Record<string, unknown>>

/**
 * A plain object holding every named export of a module namespace. With
 * CommonJS packages (React) a bundler may expose the exports only on
 * `default`, only as named bindings, or both; merge both so every name the
 * server shim re-exports (dist/aiui-externals.json) resolves.
 */
export function toModuleObject(ns: object): ModuleObject {
  const out: Record<string, unknown> = {}
  const def = (ns as { default?: unknown }).default
  if (def !== null && (typeof def === 'object' || typeof def === 'function')) {
    for (const key of Object.keys(def)) out[key] = (def as Record<string, unknown>)[key]
  }
  for (const key of Object.keys(ns)) {
    if (key !== 'default' && key !== '__esModule') out[key] = (ns as Record<string, unknown>)[key]
  }
  return Object.freeze(out)
}

export interface AiuiSdkGlobal {
  readonly version: number
  readonly modules: Readonly<Record<ShellExternal, ModuleObject>>
  readonly registerPage: typeof registerPage
  readonly registerBlock: typeof registerBlock
  readonly registerSlot: typeof registerSlot
  readonly registerToolRenderer: typeof registerToolRenderer
  readonly registerView: typeof registerView
}

const INSTALLED = Symbol.for('aiui.sdk.installed')

type SdkWindow = { __AIUI_SDK__?: AiuiSdkGlobal & { [INSTALLED]?: true } }

/** The installed SDK global, or undefined before installSdk() ran. */
export function getInstalledSdk(): AiuiSdkGlobal | undefined {
  if (typeof window === 'undefined') return undefined
  const sdk = (window as unknown as SdkWindow).__AIUI_SDK__
  return sdk && sdk[INSTALLED] ? sdk : undefined
}

/**
 * Publish `window.__AIUI_SDK__`. Idempotent: later calls keep the first
 * object, so module identities never change under a loaded plugin.
 */
export function installSdk(): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as SdkWindow
  if (w.__AIUI_SDK__?.[INSTALLED]) return
  if (w.__AIUI_SDK__) console.warn('[aiui sdk] replacing a window.__AIUI_SDK__ that this shell did not install')

  const modules = Object.freeze({
    react: toModuleObject(React),
    'react/jsx-runtime': toModuleObject(ReactJsxRuntime),
    'react-dom': toModuleObject(ReactDOM),
    'react-dom/client': toModuleObject(ReactDOMClient),
    '@aiui/sdk': sdkApi,
  } satisfies Record<ShellExternal, ModuleObject>)

  const sdk = {
    version: SDK_VERSION,
    modules,
    registerPage,
    registerBlock,
    registerSlot,
    registerToolRenderer,
    registerView,
  }
  Object.defineProperty(sdk, INSTALLED, { value: true })
  w.__AIUI_SDK__ = Object.freeze(sdk) as AiuiSdkGlobal & { [INSTALLED]?: true }
}
