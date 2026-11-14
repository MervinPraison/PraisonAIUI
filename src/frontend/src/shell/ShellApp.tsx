/**
 * Root component: theme provider, manifest bootstrap, plugin loading, toaster.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ThemeProvider } from 'next-themes'
import { preloadLegacyRuntime } from '@/legacy/runtime'
import { fetchManifest, type ShellManifest } from '@/sdk/manifest'
import { useToasterRequested } from '@/sdk/notify'
import { getPage } from '@/sdk/registry'
import { activateShell } from '@/sdk/services'
import { loadManifestPlugins } from '@/sdk/install'
import { BootError, BootSkeleton, TokenGate } from './BootScreen'
import { ShellContext, type ShellState } from './context'
import { needsLegacyRuntime } from './nav'
import { preloadCommandPalette } from './palette'
import ReactShell from './ReactShell'

const ShellToaster = lazy(() => import('./ShellToaster'))

type Boot =
  | { status: 'ready'; manifest: ShellManifest }
  | { status: 'loading' }
  | { status: 'auth' }
  | { status: 'error'; message: string }

/** Run `fn` when the browser is idle (or soon, where requestIdleCallback is missing). */
function onIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 3000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(fn, 300)
  return () => window.clearTimeout(id)
}

function hasPluginModules(m: ShellManifest): boolean {
  return m.blocks.length > 0 || m.toolRenderers.length > 0 || m.pages.some((p) => p.kind === 'react' && !!p.module)
}

// One plugin load per manifest, even under StrictMode's double effects.
const pluginLoads = new WeakMap<ShellManifest, Promise<void>>()
function loadPluginsOnce(m: ShellManifest): Promise<void> {
  let p = pluginLoads.get(m)
  if (!p) {
    p = Promise.resolve()
      .then(() => loadManifestPlugins(m))
      .catch((err: unknown) => console.warn('[aiui shell] plugin loading failed', err))
    pluginLoads.set(m, p)
  }
  return p
}

function ShellReady({ manifest }: { manifest: ShellManifest }) {
  const [pluginsSettled, setPluginsSettled] = useState(() => !hasPluginModules(manifest))

  useEffect(() => {
    let alive = true
    void loadPluginsOnce(manifest).finally(() => {
      if (alive) setPluginsSettled(true)
    })
    const cancelIdle = onIdle(() => {
      // Only when a page will actually use it: an app whose pages are all
      // React, blocks or iframes never downloads dashboard.js.
      if (needsLegacyRuntime(manifest, (id) => getPage(id) !== undefined)) preloadLegacyRuntime()
      preloadCommandPalette()
    })
    return () => {
      alive = false
      cancelIdle()
    }
  }, [manifest])

  const state = useMemo<ShellState>(() => ({ manifest, pluginsSettled }), [manifest, pluginsSettled])
  return (
    <ShellContext.Provider value={state}>
      <ReactShell />
    </ShellContext.Provider>
  )
}

function ToasterHost() {
  const requested = useToasterRequested()
  if (!requested) return null
  return (
    <Suspense fallback={null}>
      <ShellToaster />
    </Suspense>
  )
}

/**
 * The manifest is known: publish it to the SDK (useManifest) and run the
 * onActivate hooks, which is how first-party plugins (src/builtin) register
 * the pages this manifest lists. It happens before anything renders, so a deep
 * link to one of those pages resolves on the first paint. Idempotent.
 */
function ready(manifest: ShellManifest): Boot {
  activateShell(manifest)
  return { status: 'ready', manifest }
}

async function loadManifest(): Promise<Boot> {
  let status = 0
  const trackingFetch: typeof fetch = async (input, init) => {
    const res = await window.fetch(input, init)
    status = res.status
    return res
  }
  try {
    return ready(await fetchManifest(trackingFetch))
  } catch (err) {
    if (status === 401 || status === 403) return { status: 'auth' }
    const detail = err instanceof Error ? err.message : String(err)
    return { status: 'error', message: `The server did not return the app manifest (${detail}).` }
  }
}

/**
 * The app's colour mode for a viewer with no stored choice: the server puts
 * set_theme(dark_mode=...) / YAML site.theme on <html data-aiui-theme-default>
 * (the inline theme bootstrap reads the same attribute before first paint).
 */
export function shellDefaultTheme(root: HTMLElement = document.documentElement): 'light' | 'dark' | 'system' {
  const v = root.getAttribute('data-aiui-theme-default')
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function ShellApp({ initialManifest }: { initialManifest: ShellManifest | null }) {
  const [boot, setBoot] = useState<Boot>(() =>
    initialManifest ? ready(initialManifest) : { status: 'loading' },
  )

  useEffect(() => {
    if (boot.status !== 'loading') return
    let cancelled = false
    void loadManifest().then((next) => {
      if (!cancelled) setBoot(next)
    })
    return () => {
      cancelled = true
    }
  }, [boot.status])

  const reload = () => setBoot({ status: 'loading' })

  return (
    <ThemeProvider attribute="class" storageKey="aiui-theme-preference" defaultTheme={shellDefaultTheme()} enableSystem disableTransitionOnChange>
      {boot.status === 'ready' ? (
        <ShellReady manifest={boot.manifest} />
      ) : boot.status === 'auth' ? (
        <TokenGate onAuthenticated={reload} />
      ) : boot.status === 'error' ? (
        <BootError message={boot.message} onRetry={reload} />
      ) : (
        <BootSkeleton />
      )}
      <ToasterHost />
    </ThemeProvider>
  )
}
