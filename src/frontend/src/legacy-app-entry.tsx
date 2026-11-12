import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

/**
 * The pre-shell React UI (styles chat, docs, agents, playground, custom).
 * main.tsx lazy-loads this chunk unless <html data-aiui-shell="react"> is set.
 * Rendering is exactly what main.tsx did before the boot split.
 */
export function mountApp(el: HTMLElement) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
