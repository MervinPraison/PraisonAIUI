// aiui-hello-plugin browser module: hand-written ESM, no build step.
//
// The bare specifiers below are NOT bundled. The app shell's import map points
// them at /_aiui/externals/*.js shims that re-export the shell's own modules
// from window.__AIUI_SDK__, so this file shares the shell's single React
// (hooks work; no "Invalid hook call"). Allowed specifiers: 'react',
// 'react/jsx-runtime', 'react-dom', 'react-dom/client' and '@aiui/sdk'.
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Markdown, registerBlock, registerToolRenderer } from '@aiui/sdk'

// Style with the theme's CSS variables: the shell's Tailwind build only
// contains the classes the shell itself uses.
const S = {
  page: { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '760px' },
  title: { margin: 0, fontSize: '20px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--foreground)' },
  text: { margin: 0, fontSize: '15px', lineHeight: 1.55, color: 'var(--muted-foreground)' },
  row: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  button: {
    height: '32px',
    padding: '0 12px',
    borderRadius: '8px',
    border: '1px solid transparent',
    background: 'var(--primary)',
    color: 'var(--primary-foreground)',
    font: 'inherit',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  meta: { fontSize: '13px', color: 'var(--muted-foreground)' },
  tool: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    fontSize: '14px',
    color: 'var(--foreground)',
  },
  temp: { fontSize: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
}

const INTRO = [
  'This page is the default export of `static/hello.js` in **aiui-hello-plugin**.',
  'It imports `useState` from the shell, and renders this text with the',
  'shell’s `Markdown` component from `@aiui/sdk`.',
].join(' ')

/** The /hello page. Receives the manifest entry as `page`. */
export default function HelloPage({ page }) {
  const [count, setCount] = useState(0)
  return jsxs('section', {
    'data-testid': 'hello-plugin',
    style: S.page,
    children: [
      jsx('h2', { style: S.title, children: 'Hello from a plugin' }),
      jsx(Markdown, { variant: 'docs', children: INTRO }),
      jsxs('div', {
        style: S.row,
        children: [
          jsx('button', {
            type: 'button',
            'data-testid': 'hello-count',
            style: S.button,
            onClick: () => setCount((n) => n + 1),
            children: `Clicked ${count} ${count === 1 ? 'time' : 'times'}`,
          }),
          jsx('span', { style: S.meta, children: `State lives in the shell’s React · page id “${page ? page.id : '?'}”` }),
        ],
      }),
      jsx('p', { style: S.text, children: 'Open “Hello blocks” for the server-driven version.' }),
    ],
  })
}

/**
 * Chat renderer for the `get_weather` tool. Registered here (self-registration
 * through @aiui/sdk); the manifest's toolRenderers entry only makes the shell
 * import this module.
 */
function WeatherTool({ args, result, status }) {
  const input = args || {}
  const data = result && typeof result === 'object' ? result : {}
  const done = !status || status.type === 'complete'
  const city = input.city || input.location || data.city || 'somewhere'
  return jsxs('div', {
    'data-testid': 'hello-weather',
    style: S.tool,
    children: [
      jsx('span', { style: S.temp, children: done && data.temperature != null ? `${data.temperature}°` : '…' }),
      jsxs('span', {
        children: [
          jsx('strong', { children: city }),
          jsx('span', { style: S.meta, children: done ? ` · ${data.conditions || 'no data'}` : ' · checking the sky' }),
        ],
      }),
    ],
  })
}

registerToolRenderer('get_weather', WeatherTool)

/**
 * A block type for server-driven pages: `{"type": "hello_badge", "text": ...}`.
 * Block components receive `{ node, page }`; flat dict keys are in `node.props`.
 */
function HelloBadge({ node }) {
  const text = (node.props && node.props.text) || 'Hello'
  return jsxs('div', {
    'data-testid': 'hello-badge',
    style: { ...S.tool, width: 'fit-content', borderStyle: 'dashed' },
    children: [jsx('span', { 'aria-hidden': true, children: '👋' }), jsx('span', { children: String(text) })],
  })
}

registerBlock('hello_badge', HelloBadge)
