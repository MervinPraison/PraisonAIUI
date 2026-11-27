import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { installAuthFetch } from '@/lib/auth'
import AuthGate from './AuthGate'

/**
 * The pre-shell React UI (styles chat, docs, agents, playground, custom).
 * main.tsx lazy-loads this chunk unless <html data-aiui-shell="react"> is set.
 * Same-origin requests carry the stored token (lib/auth), as in the app
 * shell, so a docs site behind AUTH_ENFORCE or require_auth reads its pages;
 * AuthGate asks a signed-out reader to sign in.
 */
export function mountApp(el: HTMLElement) {
  installAuthFetch()
  createRoot(el).render(
    <StrictMode>
      <AuthGate>
        <App />
      </AuthGate>
    </StrictMode>,
  )
  void import('@/lib/viewportGuard')
    .then((m) => m.bindSurfaceChrome(document.body))
    .catch(() => undefined)
}
