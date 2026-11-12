/**
 * CONTRACT STUB (WP0a). WP4 replaces this file with the host that mounts a
 * legacy dashboard view through legacy/runtime.ts mountView().
 * Contract (ADR-0001 §5):
 *   export function LegacyViewHost(p: { pageId: string; page?: ShellPage }): JSX.Element
 */
import type { JSX } from 'react'
import type { ShellPage } from '../sdk/manifest'

export interface LegacyViewHostProps {
  pageId: string
  page?: ShellPage
}

export function LegacyViewHost({ pageId, page }: LegacyViewHostProps): JSX.Element {
  return (
    <div className="aiui-legacy-host" data-legacy-page={pageId} data-status="stub" data-aiui-stub="legacy-view-host">
      {page?.title ?? pageId}
    </div>
  )
}
