/**
 * Canvas-only mount of the official A2UI basic catalog.
 * The dashboard loads /assets/a2ui-island.js. Chat does not.
 */
import { createRoot, type Root } from 'react-dom/client'
import { A2uiSurface, basicCatalog } from '@a2ui/react/v0_9'
import { MessageProcessor } from '@a2ui/web_core/v0_9'
import { toOfficialMessages } from './a2ui-official'

const roots = new WeakMap<HTMLElement, Root>()

export function mountA2ui(host: HTMLElement, surfaceId: string, messages: unknown): boolean {
  const official = toOfficialMessages(messages, surfaceId)
  if (!official) return false

  const processor = new MessageProcessor([basicCatalog], (action) => {
    const sid = action.surfaceId || surfaceId
    fetch('/api/surfaces/' + encodeURIComponent(sid) + '/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component_id: action.sourceComponentId,
        action: action.name,
        data: action.context ?? {},
      }),
    }).catch(() => {})
  })

  try {
    processor.processMessages(official)
  } catch {
    return false
  }

  const surface = processor.model.getSurface(surfaceId) ?? processor.model.surfacesMap.values().next().value
  if (!surface) return false

  let node = host.querySelector(':scope > .a2ui-official') as HTMLElement | null
  if (!node) {
    host.replaceChildren()
    node = document.createElement('div')
    node.className = 'a2ui-official'
    host.appendChild(node)
  }

  let root = roots.get(node)
  if (!root) {
    root = createRoot(node)
    roots.set(node, root)
  }
  root.render(<A2uiSurface surface={surface} processor={processor} />)
  return true
}
