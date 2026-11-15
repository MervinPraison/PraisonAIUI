/**
 * builtin.artifacts: the browser half of the Python record of the same name
 * (builtin/catalog.py), which owns the shell-only page `artifacts`
 * (`layouts: ['chat-canvas']`): the index of every chat's artifacts, where
 * the canvas's Share links land.
 *
 * The server lists the page only while the record is on (a layout that needs
 * it, Chat and Canvas, is on offer, and `extensions.disabled` does not name
 * it), so this activates only then; otherwise /artifacts is "Page not found"
 * and the canvas works from the chat alone. The page is behind import():
 * its code (chunk `lf-artifacts`) loads only when /artifacts is opened.
 */
import type { BuiltinPlugin } from './types'

export const ARTIFACTS_PAGE_ID = 'artifacts'

export const loadArtifactsPage = () => import('@/layout-features/artifacts/ArtifactsPage')

export const artifactsBuiltin: BuiltinPlugin = {
  name: 'builtin.artifacts',
  pages: [ARTIFACTS_PAGE_ID],
  activate(sdk) {
    sdk.registerPage(ARTIFACTS_PAGE_ID, loadArtifactsPage)
  },
}
