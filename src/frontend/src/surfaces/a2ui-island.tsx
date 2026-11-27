/**
 * Canvas & App-Shell mount of the official A2UI basic catalog (@a2ui/react/v0_9).
 * Loaded lazily from /plugins/a2ui-island.js when a surface has messages.
 * It is not part of the default page bundle; boot and chat stay untouched (R4, R10).
 */
import { createRoot, type Root } from 'react-dom/client'
import { A2uiSurface, basicCatalog } from '@a2ui/react/v0_9'
import { MessageProcessor } from '@a2ui/web_core/v0_9'
import { toOfficialMessages } from './a2ui-official'

const roots = new WeakMap<HTMLElement, Root>()

export type A2uiActionHandler = (payload: {
  surfaceId: string
  component_id: string
  action: string
  data: Record<string, unknown>
  timestamp?: string
}) => void | Promise<void>

export function unmountA2ui(host: HTMLElement | null): void {
  if (!host) return
  const node = host.querySelector(':scope > .a2ui-official') as HTMLElement | null
  if (!node) return
  const root = roots.get(node)
  if (root) {
    root.unmount()
    roots.delete(node)
  }
  node.remove()
}

export function mountA2ui(
  host: HTMLElement,
  surfaceId: string,
  messages: unknown,
  onAction?: A2uiActionHandler,
): boolean {
  const official = toOfficialMessages(messages, surfaceId)
  if (!official) return false

  // Pure deleteSurface clears the mounted host cleanly.
  if (official.every((m) => Boolean(m.deleteSurface))) {
    unmountA2ui(host)
    host.replaceChildren()
    return true
  }

  const processor = new MessageProcessor([basicCatalog], (action) => {
    const sid = action.surfaceId || surfaceId
    const payload = {
      surfaceId: sid,
      component_id: action.sourceComponentId ?? '',
      action: action.name ?? '',
      data: (action.context ?? {}) as Record<string, unknown>,
      timestamp: action.timestamp,
    }
    if (typeof onAction === 'function') {
      void onAction(payload)
      return
    }
    fetch('/api/surfaces/' + encodeURIComponent(sid) + '/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        component_id: payload.component_id,
        action: payload.action,
        data: payload.data,
        timestamp: payload.timestamp,
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
