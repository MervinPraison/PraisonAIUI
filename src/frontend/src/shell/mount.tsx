/**
 * CONTRACT STUB (WP0a). WP6 replaces this file with the React shell.
 * Contract (ADR-0001 §5): export function mountShell(el: HTMLElement): void
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// eslint-disable-next-line react-refresh/only-export-components -- mount entry, not an HMR boundary
function ShellPlaceholder() {
  return (
    <div className="aiui-app" data-aiui-stub="shell" role="status">
      Shell loading
    </div>
  )
}

export function mountShell(el: HTMLElement): void {
  createRoot(el).render(
    <StrictMode>
      <ShellPlaceholder />
    </StrictMode>,
  )
}
