// aurora: a third-party layout frame, hand-written ESM, no build step.
//
// The shell imports this file only while Aurora is the active layout. It
// registers itself with registerLayout (its meta, chat presentation included,
// replaces the title and description the manifest gave). The shell hands the
// frame everything as props: the routed page (Outlet), the nav model, the
// chrome (palette, colour mode, slots) and the viewport. Bare specifiers
// resolve through the shell's import map to its own React and SDK.
import { jsx, jsxs } from 'react/jsx-runtime'
import { registerLayout, useLayout } from '@aiui/sdk'

// Style with the theme's CSS variables: the shell's Tailwind build only holds
// the classes the shell itself uses.
const S = {
  root: { display: 'flex', flex: '1 1 0%', minWidth: 0, minHeight: 0 },
  rail: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    width: '200px',
    flexShrink: 0,
    padding: '12px',
    overflowY: 'auto',
    background: 'var(--sidebar)',
    borderRight: '1px solid var(--sidebar-border)',
    color: 'var(--sidebar-foreground)',
  },
  brand: { margin: '0 0 8px', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)' },
  link: (active) => ({
    display: 'block',
    padding: '6px 8px',
    borderRadius: '8px',
    fontSize: '14px',
    textDecoration: 'none',
    color: active ? 'var(--foreground)' : 'var(--sidebar-foreground)',
    background: active ? 'var(--sidebar-accent)' : 'transparent',
    fontWeight: active ? 500 : 400,
  }),
  button: {
    marginTop: 'auto',
    height: '32px',
    borderRadius: '8px',
    border: '1px solid var(--input)',
    background: 'transparent',
    color: 'var(--foreground)',
    font: 'inherit',
    fontSize: '13px',
    cursor: 'pointer',
  },
  column: { display: 'flex', flexDirection: 'column', flex: '1 1 0%', minWidth: 0 },
  bar: {
    display: 'flex',
    alignItems: 'center',
    height: '48px',
    padding: '0 16px',
    borderBottom: '1px solid var(--border)',
    fontSize: '14px',
    fontWeight: 600,
  },
  main: (fullBleed) => ({
    flex: '1 1 0%',
    minHeight: 0,
    outline: 'none',
    ...(fullBleed ? { display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { overflowY: 'auto' }),
  }),
}

function Link({ item, go }) {
  return jsx('a', {
    href: item.href,
    'aria-current': item.active ? 'page' : undefined,
    'data-aurora-link': item.id,
    style: S.link(item.active),
    onClick: (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      go(item.id)
    },
    children: item.title,
  })
}

function AuroraFrame({ Outlet, nav, chrome, page, fullBleed, viewport }) {
  // useLayout() reports this layout to every page (chat reads its presentation).
  const active = useLayout()
  const items = [...nav.primary, ...nav.groups.flatMap((g) => g.items), ...nav.footer]
  return jsxs('div', {
    style: S.root,
    'data-aiui-layout-frame': 'aurora',
    'data-viewport': viewport,
    'data-active-layout': active ? active.id : '',
    children: [
      jsxs('nav', {
        'aria-label': 'Main',
        style: S.rail,
        children: [
          jsx('p', { style: S.brand, children: `${chrome.siteTitle} · Aurora` }),
          ...items.map((item) => jsx(Link, { item, go: nav.go }, item.id)),
          jsx('button', { type: 'button', style: S.button, onClick: () => chrome.openPalette(), children: 'Search and more' }),
        ],
      }),
      jsxs('div', {
        style: S.column,
        children: [
          jsxs('header', { style: S.bar, children: [page ? page.title : chrome.siteTitle, jsx(chrome.Slot, { name: 'header:actions' })] }),
          jsx('main', { id: chrome.mainId, tabIndex: -1, style: S.main(fullBleed), children: jsx(Outlet, {}) }),
        ],
      }),
    ],
  })
}

registerLayout('aurora', { title: 'Aurora', description: 'A slim rail and the page (plugin layout).' }, AuroraFrame)
