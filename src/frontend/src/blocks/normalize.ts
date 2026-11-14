/**
 * Server block trees → BlockNode.
 *
 * Page handlers return the legacy dashboard shape: flat component dicts such
 * as `{"type": "card", "title": "Users", "value": 3}` (see praisonaiui/ui.py),
 * under `_components` (also accepted: `components`, `blocks`, or a bare
 * array). The SDK shape `{type, props, children}` is accepted as well.
 *
 * Every flat key except `type` and `children` becomes a prop. Nested component
 * lists stay where the legacy format puts them (`children`, `columns`,
 * `items[].children`, ...); core blocks normalise them when they render.
 * The original dict is remembered so the legacy fallback can hand
 * `window.aiui.renderComponent()` exactly what the server sent.
 */
import type { BlockNode } from '@/sdk/registry'

export type RawComponent = Record<string, unknown>

const original = new WeakMap<BlockNode, RawComponent>()

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** One component dict (flat or `{type, props, children}`) → BlockNode, else null. */
export function toBlockNode(raw: unknown): BlockNode | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || !raw.type) return null
  const { type, props, children, ...rest } = raw
  const node: BlockNode = {
    type: type as string,
    props: isRecord(props) ? { ...rest, ...props } : rest,
  }
  if (typeof children === 'string') node.children = children
  else if (Array.isArray(children)) node.children = toBlockNodes(children)
  original.set(node, raw)
  return node
}

// Nested lists inside props (columns, tabs items, ...) are normalised while
// rendering; caching by array identity keeps the resulting nodes stable across
// re-renders, so blocks keyed on their node (legacy fallback) do not remount.
const listCache = new WeakMap<unknown[], BlockNode[]>()
const EMPTY: BlockNode[] = []

export function toBlockNodes(list: unknown): BlockNode[] {
  if (!Array.isArray(list)) {
    const one = toBlockNode(list)
    return one ? [one] : EMPTY
  }
  const cached = listCache.get(list)
  if (cached) return cached
  const out: BlockNode[] = []
  for (const item of list) {
    const node = toBlockNode(item)
    if (node) out.push(node)
  }
  listCache.set(list, out)
  return out
}

export interface BlockTree {
  nodes: BlockNode[]
  /** True when the payload had no component list (rendered as raw JSON). */
  raw: boolean
}

/**
 * A page payload → its block tree. Mirrors dashboard.js renderComponents():
 * `_surface` renders as an A2UI surface, `_components` as components, and
 * anything else as a JSON viewer.
 */
export function toBlockTree(data: unknown): BlockTree {
  if (Array.isArray(data)) return { nodes: toBlockNodes(data), raw: false }
  if (isRecord(data)) {
    if (isRecord(data._surface)) {
      const surface = data._surface
      const node = toBlockNode({
        type: 'a2ui_surface',
        surface_id: typeof surface.id === 'string' ? surface.id : 'main',
        messages: Array.isArray(surface.messages) ? surface.messages : [],
      })
      return { nodes: node ? [node] : [], raw: false }
    }
    for (const key of ['_components', 'components', 'blocks'] as const) {
      if (Array.isArray(data[key])) return { nodes: toBlockNodes(data[key]), raw: false }
    }
    if (typeof data.type === 'string') {
      const node = toBlockNode(data)
      if (node) return { nodes: [node], raw: false }
    }
  }
  const json = toBlockNode({ type: 'json_view', data })
  return { nodes: json ? [json] : [], raw: true }
}

/** True when `data` carries a block tree (an action response that replaces the page). */
export function hasBlockTree(data: unknown): boolean {
  if (Array.isArray(data)) return true
  return isRecord(data) && (['_components', 'components', 'blocks'].some((k) => Array.isArray(data[k])) || isRecord(data._surface))
}

/** BlockNode → the flat dict dashboard.js renderComponent() expects. */
export function toLegacyComponent(node: BlockNode): RawComponent {
  const raw = original.get(node)
  if (raw && !isRecord(raw.props)) return raw
  const out: RawComponent = { ...(node.props ?? {}), type: node.type }
  if (typeof node.children === 'string') out.children = node.children
  else if (Array.isArray(node.children)) out.children = node.children.map(toLegacyComponent)
  return out
}

// ── prop readers (server data is untyped) ─────────────────────────────

export function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return fallback
}

export function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i

/**
 * A URL safe to put in `href` / `src`: relative, http(s), mailto: and tel:
 * (plus `data:image/*` for images). Anything else (javascript:, vbscript:,
 * data:text/html, ...) returns undefined. Block data is untyped server JSON
 * that may carry user content, so it is never trusted as a URL.
 */
export function safeUrl(v: unknown, kind: 'link' | 'image' = 'link'): string | undefined {
  const raw = str(v).trim()
  if (!raw) return undefined
  if (kind === 'image' && SAFE_IMAGE_DATA.test(raw)) return raw
  try {
    // Control characters and whitespace inside a scheme are ignored by
    // browsers ("java\tscript:"); URL parsing normalises them the same way.
    const url = new URL(raw, 'http://relative.invalid/')
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? raw : undefined
  } catch {
    return undefined
  }
}

/** A displayable cell/value: primitives as text, objects as compact JSON. */
export function display(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}
