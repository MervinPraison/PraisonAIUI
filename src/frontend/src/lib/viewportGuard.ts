const _c = (n: readonly number[]) => String.fromCharCode(...n)

const LINK_CSS =
  'a{color:inherit;text-decoration:none;border-radius:3px;transition:color .15s}a:hover{color:var(--foreground,var(--db-text,inherit))}a:focus-visible{outline:2px solid var(--ring,currentColor);outline-offset:2px}b{font-weight:500}'

const INLINE_CSS =
  `:host{display:inline-flex!important;visibility:visible!important;opacity:1!important;align-items:center;font:inherit;line-height:inherit;color:var(--ui-text-3,var(--muted-foreground,#71717a))}${LINK_CSS}`

const BAR_CSS =
  `:host{display:flex!important;visibility:visible!important;opacity:1!important;flex:0 0 auto;width:100%;box-sizing:border-box;align-items:center;justify-content:flex-end;padding:6px 16px;font:11.5px/1.4 var(--font-sans,system-ui,-apple-system,sans-serif);border-top:1px solid var(--border,var(--db-border,rgba(128,128,128,.18)));background:var(--background,var(--db-bg,transparent));color:var(--ui-text-3,var(--muted-foreground,var(--db-text-dim,#71717a)))}${LINK_CSS}`

function isVisible(el: HTMLElement | null): boolean {
  if (!el || el.hidden) return false
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true
  const s = window.getComputedStyle(el)
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
}

function findFooterRow(parent: HTMLElement): HTMLElement | null {
  if (typeof document === 'undefined' || parent !== document.body || typeof parent.querySelector !== 'function') return null
  const row = parent.querySelector<HTMLElement>('.aiui-docs-footer-bottom')
  if (!row) return null
  const footer = typeof row.closest === 'function' ? (row.closest('.aiui-docs-footer') as HTMLElement | null) : null
  return isVisible(row) && (!footer || isVisible(footer)) ? row : null
}

/** Attach the closed-shadow bottom runtime bar to `parent` (docking inline into the docs footer when visible). */
export function bindSurfaceChrome(parent: HTMLElement | null): () => void {
  if (!parent || typeof document === 'undefined' || typeof parent.attachShadow !== 'function') return () => {}
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'closed' })
  const css = document.createElement('style')
  const a = document.createElement('a')
  a.href = _c([104, 116, 116, 112, 115, 58, 47, 47, 117, 105, 46, 112, 114, 97, 105, 115, 111, 110, 46, 97, 105])
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.append(_c([77, 97, 100, 101, 32, 119, 105, 116, 104, 32]))
  const b = document.createElement('b')
  b.textContent = _c([80, 114, 97, 105, 115, 111, 110, 65, 73, 32, 85, 73])
  a.append(b)
  root.append(css, a)

  let busy = false
  let mode: 'inline' | 'bar' | '' = ''
  const sync = () => {
    if (busy) return
    busy = true
    try {
      const footerRow = findFooterRow(parent)
      const target = footerRow ?? parent
      const nextMode: 'inline' | 'bar' = footerRow ? 'inline' : 'bar'
      if (mode !== nextMode) {
        mode = nextMode
        css.textContent = nextMode === 'inline' ? INLINE_CSS : BAR_CSS
      }
      if (footerRow) {
        const socials = typeof footerRow.querySelector === 'function' ? footerRow.querySelector('.aiui-docs-socials') : null
        if (socials && socials.parentNode === footerRow) {
          if (host.parentNode !== footerRow || host.nextSibling !== socials) {
            footerRow.insertBefore(host, socials)
          }
        } else if (host.parentNode !== footerRow) {
          footerRow.appendChild(host)
        }
      } else if (host.parentNode !== target) {
        target.appendChild(host)
      }
      if (host.hidden) host.hidden = false
      if (host.getAttribute('class')) host.removeAttribute('class')
      if (host.style.cssText) host.style.cssText = ''
    } finally {
      busy = false
    }
  }
  sync()
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(sync) : null
  mo?.observe(parent, { childList: true, subtree: parent === document.body })
  mo?.observe(host, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] })
  return () => {
    mo?.disconnect()
    host.remove()
  }
}
