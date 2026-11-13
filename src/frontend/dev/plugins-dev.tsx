// WP7 dev harness (see plugins-dev.html). Not built, not type-checked by tsc -b.
import '@/index.css'
import { StrictMode, Suspense, createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import BlockPage from '@/blocks/BlockPage'
import { installSdk, type PluginLoadReport } from '@/sdk/install'
import { loadPluginModules } from '@/sdk/loadPlugins'
import { fetchManifest, type ShellManifest, type ShellPage } from '@/sdk/manifest'
import { getPage, getToolRenderers, useRegistryVersion } from '@/sdk/registry'

declare global {
  interface Window {
    __pluginsHarness?: { manifest?: ShellManifest; report?: PluginLoadReport; error?: string }
  }
}

installSdk() // before any plugin import()
window.__pluginsHarness = {}

function useHash(): string {
  const [hash, setHash] = useState(() => location.hash.slice(1))
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

function PageView({ page }: { page: ShellPage }) {
  useRegistryVersion()
  if (page.kind === 'blocks') return <BlockPage page={page} />
  const C = getPage(page.id)
  if (!C) return <p className="text-sm text-muted-foreground" data-testid="page-missing">No component for {page.id}</p>
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading page</p>}>
      {createElement(C, { page })}
    </Suspense>
  )
}

function ToolDemo() {
  useRegistryVersion()
  const R = getToolRenderers().get_weather
  if (!R) return null
  return (
    <section className="flex flex-col gap-2" data-testid="tool-demo">
      <h2 className="text-sm font-semibold">Tool renderer: get_weather</h2>
      {createElement(R, {
        toolName: 'get_weather',
        args: { city: 'Lisbon' },
        argsText: '{"city":"Lisbon"}',
        result: { temperature: 21, conditions: 'Sunny' },
        status: { type: 'complete' },
      })}
    </section>
  )
}

function Harness() {
  const [manifest, setManifest] = useState<ShellManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const hash = useHash()

  useEffect(() => {
    let live = true
    fetchManifest()
      .then(async (m) => {
        if (!live) return
        window.__pluginsHarness!.manifest = m
        setManifest(m)
        const report = await loadPluginModules(m)
        window.__pluginsHarness!.report = report
        if (live) setReady(true)
      })
      .catch((e) => {
        window.__pluginsHarness!.error = String(e)
        if (live) setError(String(e))
      })
    return () => {
      live = false
    }
  }, [])

  const pages = (manifest?.pages ?? []).filter((p) => p.kind === 'react' || p.kind === 'blocks')
  const current = pages.find((p) => p.id === hash) ?? pages[0]

  return (
    <div className="aiui-app flex min-h-screen bg-background text-foreground">
      <nav className="flex w-60 shrink-0 flex-col gap-1 border-r border-border p-3 text-sm" aria-label="Plugin pages">
        <div className="px-2 pb-2 text-xs text-muted-foreground" data-testid="harness-status">
          {error ? `error: ${error}` : ready ? 'plugins loaded' : 'loading plugins'}
        </div>
        {pages.map((p) => (
          <a
            key={p.id}
            href={`#${p.id}`}
            data-testid={`nav-${p.id}`}
            aria-current={p === current ? 'page' : undefined}
            className="rounded-md px-2 py-1.5 hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:font-medium"
          >
            {p.title} <span className="text-xs text-muted-foreground">· {p.kind}</span>
          </a>
        ))}
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-8 p-6" data-testid="harness-main">
        {current && (
          <div key={current.id} data-testid={`page-${current.id}`} className="flex min-w-0 flex-col gap-4">
            <h1 className="text-xl font-semibold tracking-tight">{current.title}</h1>
            <PageView page={current} />
          </div>
        )}
        {ready && <ToolDemo />}
      </main>
      <Toaster richColors closeButton />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
