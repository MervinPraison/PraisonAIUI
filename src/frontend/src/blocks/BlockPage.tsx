/**
 * CONTRACT STUB (WP0a). WP7 replaces this file with the `kind=blocks` page
 * renderer. Contract (ADR-0001 §5):
 *   export default function BlockPage(p: { page: ShellPage }): JSX.Element
 */
import type { JSX } from 'react'
import type { ShellPage } from '../sdk/manifest'

export default function BlockPage({ page }: { page: ShellPage }): JSX.Element {
  return (
    <div data-aiui-stub="block-page" data-page-id={page.id}>
      {page.title}
    </div>
  )
}
