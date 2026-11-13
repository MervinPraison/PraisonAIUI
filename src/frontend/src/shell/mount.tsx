/**
 * React shell entry (style `app`). main.tsx lazy-imports this module when
 * <html data-aiui-shell="react">. Contract (ADR-0001 §5):
 *   export function mountShell(el: HTMLElement): void
 *
 * Boot budget: this module's static closure (+ index.js, vendor-react and
 * index.css) must stay ≤ 150,000 B gzip. Everything heavy is lazy: the
 * command palette (cmdk), the mobile Sheet, the sonner Toaster,
 * LegacyViewHost, BlockPage and every registered page.
 */
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { activateBuiltins } from '@/builtin'
import { setLegacyNavigator } from '@/legacy/runtime'
import { installSdk } from '@/sdk/install'
import { readBootManifest } from '@/sdk/manifest'
import { installAuthFetch } from './auth'
import { installPaletteHooks } from './palette'
import { navigate, patchHistory, rewriteHashDeepLink } from './router'
import { ShellApp } from './ShellApp'

const roots = new WeakMap<HTMLElement, Root>()

export function mountShell(el: HTMLElement): void {
  if (roots.has(el)) return
  // 1. Same-origin requests carry the stored gateway token.
  installAuthFetch()
  // 2. window.__AIUI_SDK__ exists before any plugin module is imported.
  installSdk()
  // First-party pages register through the same SDK as plugins (src/builtin).
  activateBuiltins()
  // 3. Routing: patched history, legacy hash deep links, legacy selectPage → shell.
  patchHistory()
  rewriteHashDeepLink()
  setLegacyNavigator(navigate)
  installPaletteHooks()
  // 4. Render; ShellApp fetches the manifest when the inline copy is partial.
  const root = createRoot(el)
  roots.set(el, root)
  root.render(
    <StrictMode>
      <ShellApp initialManifest={readBootManifest()} />
    </StrictMode>,
  )
}
