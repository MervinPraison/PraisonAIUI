/**
 * Browser-side registry for pages, blocks, tool renderers and slots
 * (ADR-0001 §5). The shell resolves a page id here first, then `kind=blocks`
 * (BlockPage), then the legacy host. Plugins reach these functions through
 * `@aiui/sdk` (window.__AIUI_SDK__).
 *
 * FROZEN CONTRACT: change only additively.
 */
import { lazy, useSyncExternalStore, type ComponentType } from 'react'
import type { ShellPage } from './manifest'

export interface BlockNode {
  type: string
  props?: Record<string, unknown>
  children?: BlockNode[] | string
}

export type PageComponent = ComponentType<{ page: ShellPage }>
export type PageLoader = () => Promise<{ default: PageComponent }>
export type BlockComponent = ComponentType<{ node: BlockNode; page?: ShellPage }>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComponent = ComponentType<any>

const pages = new Map<string, PageComponent>()
const blocks = new Map<string, BlockComponent>()
const toolRenderers = new Map<string, AnyComponent>()
const slots = new Map<string, AnyComponent>()
const listeners = new Set<() => void>()

let version = 0
let toolRenderersSnapshot: Record<string, AnyComponent> | null = null

function emit() {
  version += 1
  toolRenderersSnapshot = null
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (err) {
      console.error('[aiui sdk] registry listener failed', err)
    }
  }
}

function requireName(kind: string, name: unknown): string {
  if (typeof name !== 'string' || !name) {
    throw new TypeError(`[aiui sdk] ${kind}: expected a non-empty string id, got ${String(name)}`)
  }
  return name
}

function requireComponent(kind: string, name: string, c: unknown) {
  const ok =
    typeof c === 'function' ||
    // memo / forwardRef / lazy components are objects with $$typeof
    (typeof c === 'object' && c !== null && '$$typeof' in c)
  if (!ok) throw new TypeError(`[aiui sdk] ${kind}('${name}'): expected a React component`)
}

function setEntry<T>(map: Map<string, T>, kind: string, name: string, value: T) {
  const prev = map.get(name)
  if (prev === value) return
  if (prev !== undefined) console.warn(`[aiui sdk] ${kind}('${name}') replaces an earlier registration`)
  map.set(name, value)
  emit()
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (
    (typeof v === 'object' || typeof v === 'function') &&
    v !== null &&
    typeof (v as { then?: unknown }).then === 'function'
  )
}

/**
 * A zero-argument arrow function (no `prototype`) is treated as a lazy loader,
 * e.g. `registerPage('chat', () => import('./ChatPage'))`. Components declared
 * with `function`, classes, and memo/forwardRef/lazy objects are components.
 */
function looksLikeLoader(c: unknown): boolean {
  return typeof c === 'function' && c.length === 0 && !('prototype' in c && c.prototype)
}

function lazyPage(load: () => unknown, fallbackComponent: PageComponent): PageComponent {
  return lazy(async () => {
    let result: unknown
    try {
      result = load()
    } catch {
      // Calling a zero-arg arrow *component* outside render can throw
      // (hooks). It was a component after all.
      return { default: fallbackComponent }
    }
    if (!isThenable(result)) return { default: fallbackComponent }
    const mod = await result
    const c =
      typeof mod === 'object' && mod !== null && 'default' in mod
        ? (mod as { default: unknown }).default
        : mod
    requireComponent('registerPage', '<loader result>', c)
    return { default: c as PageComponent }
  }) as unknown as PageComponent
}

/**
 * Register a React page for a shell page id. `c` is a component, or a loader
 * returning `import()` of a module whose default export is the component.
 * Render the result of getPage() inside <Suspense>: a loader becomes a
 * React.lazy component.
 */
export function registerPage(id: string, c: PageComponent | PageLoader): void {
  const name = requireName('registerPage', id)
  requireComponent('registerPage', name, c)
  const component = looksLikeLoader(c) ? lazyPage(c as () => unknown, c as PageComponent) : (c as PageComponent)
  setEntry(pages, 'registerPage', name, component)
}

export function registerBlock(type: string, c: BlockComponent): void {
  const name = requireName('registerBlock', type)
  requireComponent('registerBlock', name, c)
  setEntry(blocks, 'registerBlock', name, c)
}

/** Feeds the chat Thread's `tools.by_name` renderers. */
export function registerToolRenderer(toolName: string, c: AnyComponent): void {
  const name = requireName('registerToolRenderer', toolName)
  requireComponent('registerToolRenderer', name, c)
  setEntry(toolRenderers, 'registerToolRenderer', name, c)
}

export function registerSlot(slot: string, c: AnyComponent): void {
  const name = requireName('registerSlot', slot)
  requireComponent('registerSlot', name, c)
  setEntry(slots, 'registerSlot', name, c)
}

export function getPage(id: string): PageComponent | undefined {
  return pages.get(id)
}

export function getBlock(type: string): BlockComponent | undefined {
  return blocks.get(type)
}

/** Snapshot object; its identity changes only when the registry changes. */
export function getToolRenderers(): Record<string, AnyComponent> {
  if (!toolRenderersSnapshot) toolRenderersSnapshot = Object.fromEntries(toolRenderers)
  return toolRenderersSnapshot
}

export function getSlot(name: string): AnyComponent | undefined {
  return slots.get(name)
}

/** Called after every registration change. Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getVersion() {
  return version
}

/** Re-renders the caller whenever anything is (re-)registered. */
export function useRegistryVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion)
}
