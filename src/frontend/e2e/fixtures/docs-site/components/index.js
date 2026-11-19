// The site's own components (site.components in aiui.yaml), for docs-components.spec.ts.
// Plain ESM: React and @aiui/sdk come from the page's import map.
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { registerBlock } from '@aiui/sdk'

registerBlock('Counter', ({ start = 0, label, children }) => {
  const [n, setN] = useState(start)
  return jsxs('div', {
    'data-testid': 'counter',
    children: [
      jsx('button', { type: 'button', onClick: () => setN(n + 1), children: `${label} ${n}` }),
      jsx('div', { 'data-testid': 'counter-body', children }),
    ],
  })
})

// Exported under the tag's name: the loader registers it. Its props arrive as values.
export function Price({ amount, plans }) {
  return jsx('strong', { 'data-testid': 'price', children: `$${amount} (${plans.join(', ')})` })
}

export function Broken() {
  throw new Error('fixture: this component always throws')
}
