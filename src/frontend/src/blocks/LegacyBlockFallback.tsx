/**
 * Renders a block type that neither a plugin nor the core set handles with
 * the legacy dashboard renderer (`window.aiui.renderComponent` from
 * dashboard.js), so every `_components` type users have today keeps working
 * under the app shell. It also runs custom renderers registered from
 * custom.js with `window.aiui.registerComponent(type, fn)`.
 *
 * The legacy runtime is loaded on demand (legacy/runtime.ts). When it is not
 * available, the component's JSON is shown instead.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { ensureLegacyRuntime } from '@/legacy/runtime'
import type { BlockNode } from '@/sdk/registry'
import { toLegacyComponent } from './normalize'

type RenderComponent = (comp: Record<string, unknown>) => unknown

interface LegacyAiui {
  renderComponent?: RenderComponent
  components?: Record<string, unknown>
  __queue?: [string, ArrayLike<unknown>][]
}

function legacyGlobal(): LegacyAiui | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { aiui?: LegacyAiui }).aiui
}

function legacyRenderer(): RenderComponent | undefined {
  const fn = legacyGlobal()?.renderComponent
  return typeof fn === 'function' ? fn : undefined
}

/**
 * True when custom.js registered a renderer for `type` with
 * `window.aiui.registerComponent` (already applied, or still queued until the
 * legacy runtime loads). Such renderers take priority over the core blocks,
 * as they do on the legacy dashboard.
 */
// eslint-disable-next-line react-refresh/only-export-components -- lookup helper used by BlockRenderer
export function hasLegacyCustomComponent(type: string): boolean {
  const a = legacyGlobal()
  if (!a) return false
  if (a.components && typeof a.components[type] === 'function') return true
  return (a.__queue ?? []).some(([name, args]) => name === 'registerComponent' && args?.[0] === type)
}

type Status = 'loading' | 'ready' | 'unavailable'

export function LegacyBlockFallback({ node }: { node: BlockNode }): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    let cancelled = false
    const comp = toLegacyComponent(node)

    const paint = (render: RenderComponent) => {
      try {
        const out = render(comp)
        el.replaceChildren(...(out instanceof Node ? [out] : []))
        setStatus('ready')
      } catch (err) {
        console.warn(`[aiui blocks] legacy renderer failed for '${node.type}'`, err)
        setStatus('unavailable')
      }
    }

    const ready = legacyRenderer()
    if (ready) {
      paint(ready)
    } else {
      ensureLegacyRuntime()
        .then(() => {
          if (cancelled) return
          const render = legacyRenderer()
          if (render) paint(render)
          else setStatus('unavailable')
        })
        .catch((err) => {
          if (cancelled) return
          console.warn(`[aiui blocks] no renderer for block type '${node.type}'`, err)
          setStatus('unavailable')
        })
    }
    return () => {
      cancelled = true
      el.replaceChildren()
    }
  }, [node])

  return (
    <div className="min-w-0" data-aiui-block-fallback={node.type} data-status={status}>
      {/* Imperative mount point: React never renders children into it. */}
      <div ref={mountRef} className="aiui-legacy-host min-w-0" />
      {status === 'unavailable' && (
        <pre className="max-h-80 overflow-auto rounded-lg bg-muted px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {JSON.stringify(toLegacyComponent(node), null, 2)}
        </pre>
      )}
    </div>
  )
}
