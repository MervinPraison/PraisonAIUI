/**
 * Focus handling for Streamdown's mermaid fullscreen view (streamdown 2.7.1).
 *
 * Streamdown portals a `role=dialog aria-modal=true` overlay to <body> but
 * leaves focus on the trigger behind it: Tab walks the page underneath and
 * Escape never reaches the overlay's handler. Until that is fixed upstream,
 * one capture-phase click listener does what a modal should: it moves focus
 * to the dialog's "Exit fullscreen" button, keeps Tab inside the dialog,
 * closes it on Escape and makes the rest of the page `inert`; when the dialog
 * goes away it restores the page and returns focus to the trigger.
 *
 * Loaded on demand by Markdown when a chat message contains a diagram, so it
 * costs nothing on pages without one.
 */

const TRIGGER = '[data-streamdown="mermaid-block"] button[title="View fullscreen"], [data-streamdown="mermaid-block"] button[aria-label="View fullscreen"]'
const DIALOG = '[data-streamdown="mermaid-fullscreen"]'

let installed = false

function findDialog(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(DIALOG)
  return all.length ? all[all.length - 1] : null
}

/** Make everything but the dialog inert; returns undo(). */
function isolate(dialog: HTMLElement): () => void {
  const made: HTMLElement[] = []
  for (const el of Array.from(document.body.children) as HTMLElement[]) {
    if (el === dialog || el.contains(dialog) || el.inert) continue
    el.inert = true
    made.push(el)
  }
  return () => {
    for (const el of made) el.inert = false
  }
}

function takeOver(trigger: HTMLElement, triesLeft = 10) {
  const dialog = findDialog()
  if (!dialog) {
    if (triesLeft > 0) requestAnimationFrame(() => takeOver(trigger, triesLeft - 1))
    return
  }
  const undo = isolate(dialog)
  const close = dialog.querySelector<HTMLElement>('button[title="Exit fullscreen"], button[aria-label="Exit fullscreen"]') ?? dialog.querySelector<HTMLElement>('button')
  ;(close ?? dialog).focus({ preventScroll: true })
  // Tab wraps inside the dialog (the inert page would otherwise hand focus to the browser chrome).
  // Escape closes it: Streamdown's own handler sits on the overlay, and its
  // toolbar (where focus is) stops keydown from reaching it.
  const wrap = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && close) {
      e.preventDefault()
      close.click()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey ? active === first || !dialog.contains(active) : active === last || !dialog.contains(active)) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
    }
  }
  document.addEventListener('keydown', wrap, true)
  const done = new MutationObserver(() => {
    if (dialog.isConnected) return
    done.disconnect()
    document.removeEventListener('keydown', wrap, true)
    undo()
    if (trigger.isConnected) trigger.focus({ preventScroll: true })
  })
  done.observe(document.body, { childList: true, subtree: true })
}

export function installMermaidFullscreenFocus(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener(
    'click',
    (e) => {
      const trigger = (e.target as Element | null)?.closest?.<HTMLElement>(TRIGGER)
      if (trigger) requestAnimationFrame(() => takeOver(trigger))
    },
    true,
  )
}
