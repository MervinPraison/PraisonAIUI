/**
 * Browser-side registry for pages, blocks, tool renderers and slots
 * (ADR-0001 §5). The shell resolves a page id here first, then `kind=blocks`
 * (BlockPage), then the legacy host. Plugins reach these functions through
 * `@aiui/sdk` (window.__AIUI_SDK__).
 *
 * FROZEN CONTRACT: change only additively.
 */
import { useSyncExternalStore, type ComponentType } from 'react'
import { retryableLazy } from '@/lib/retryableLazy'
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
/** Block types whose current entry is a fallback (see BlockOptions). */
const fallbackBlocks = new Set<string>()
const toolRenderers = new Map<string, AnyComponent>()
/** Options of registerSlot(). */
export interface SlotOptions {
  /**
   * Identity of this contribution within the slot, by convention the plugin
   * name. Several plugins can then share one slot; registering the same id
   * again replaces that contribution only. Without an id the call sets the
   * slot's single default contribution (the original one-per-slot behaviour).
   */
  id?: string
  /** Position within the slot: lower comes first. Default 100. */
  order?: number
}

export interface SlotContribution {
  id: string
  order: number
  component: AnyComponent
}

/** Id of the contribution registered without options. */
export const DEFAULT_SLOT_ID = 'default'
const DEFAULT_SLOT_ORDER = 100
const NO_CONTRIBUTIONS: readonly SlotContribution[] = Object.freeze([])

type SlotEntry = SlotContribution & { seq: number }
const slots = new Map<string, Map<string, SlotEntry>>()
const slotSnapshots = new Map<string, readonly SlotContribution[]>()
let slotSeq = 0
const listeners = new Set<() => void>()

let version = 0
let toolRenderersSnapshot: Record<string, AnyComponent> | null = null

function emit() {
  version += 1
  toolRenderersSnapshot = null
  slotSnapshots.clear()
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
  // Retryable: a failed chunk load is imported again on the next mount.
  return retryableLazy(async () => {
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

/** Options of registerBlock(). */
export interface BlockOptions {
  /**
   * Register a default renderer: it is used only while nothing else renders
   * the type. A fallback never replaces an existing entry, a later plain
   * `registerBlock(type, C)` replaces it without a warning, and a custom.js
   * `registerComponent(type, fn)` renderer wins over it. The first-party
   * blocks (blocks/coreBlocks.tsx) are registered this way.
   */
  fallback?: boolean
}

/**
 * Render a block type of server-driven blocks pages. Resolution order
 * (blocks/BlockRenderer.tsx): a plain registration, a custom.js renderer, a
 * fallback registration, the legacy dashboard renderer.
 */
export function registerBlock(type: string, c: BlockComponent, opts: BlockOptions = {}): void {
  const name = requireName('registerBlock', type)
  requireComponent('registerBlock', name, c)
  if (typeof opts !== 'object' || opts === null) {
    throw new TypeError(`[aiui sdk] registerBlock('${name}'): options must be an object`)
  }
  if (opts.fallback) {
    // Whatever is registered already (a plugin, or an earlier fallback) stays.
    if (blocks.has(name)) return
    blocks.set(name, c)
    fallbackBlocks.add(name)
    emit()
    return
  }
  if (fallbackBlocks.delete(name)) {
    // Overriding a default is the intended use: no "replaces" warning.
    blocks.set(name, c)
    emit()
    return
  }
  setEntry(blocks, 'registerBlock', name, c)
}

/** True when the entry getBlock(type) returns was registered with `{ fallback: true }`. */
export function isFallbackBlock(type: string): boolean {
  return fallbackBlocks.has(type)
}

/** Feeds the chat Thread's `tools.by_name` renderers. */
export function registerToolRenderer(toolName: string, c: AnyComponent): void {
  const name = requireName('registerToolRenderer', toolName)
  requireComponent('registerToolRenderer', name, c)
  setEntry(toolRenderers, 'registerToolRenderer', name, c)
}

/**
 * Contribute a component to a named slot. The shell renders every
 * contribution of `header:actions`, `sidebar:footer` and
 * `page:<id>:toolbar`, each inside its own error boundary.
 *
 * `registerSlot(slot, C)` sets the slot's default contribution and replaces
 * an earlier default. `registerSlot(slot, C, { id, order })` adds a separate
 * contribution, so several plugins can share a slot.
 */
export function registerSlot(slot: string, c: AnyComponent, opts: SlotOptions = {}): void {
  const name = requireName('registerSlot', slot)
  requireComponent('registerSlot', name, c)
  if (typeof opts !== 'object' || opts === null) {
    throw new TypeError(`[aiui sdk] registerSlot('${name}'): options must be an object`)
  }
  if (opts.id !== undefined && (typeof opts.id !== 'string' || !opts.id)) {
    throw new TypeError(`[aiui sdk] registerSlot('${name}'): options.id must be a non-empty string`)
  }
  if (opts.order !== undefined && (typeof opts.order !== 'number' || !Number.isFinite(opts.order))) {
    throw new TypeError(`[aiui sdk] registerSlot('${name}'): options.order must be a finite number`)
  }
  const id = opts.id ?? DEFAULT_SLOT_ID
  const order = opts.order ?? DEFAULT_SLOT_ORDER
  let entries = slots.get(name)
  if (!entries) slots.set(name, (entries = new Map()))
  const prev = entries.get(id)
  if (prev && prev.component === c && prev.order === order) return
  if (prev && prev.component !== c) {
    const which = id === DEFAULT_SLOT_ID ? '' : `, { id: '${id}' }`
    console.warn(`[aiui sdk] registerSlot('${name}'${which}) replaces an earlier registration`)
  }
  // A replacement keeps its place among contributions of the same order.
  entries.set(id, { id, order, component: c, seq: prev ? prev.seq : (slotSeq += 1) })
  emit()
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

/**
 * Every contribution to a slot, sorted by `order`, then by first
 * registration. The array is frozen and keeps its identity until the registry
 * changes, so it is safe as a useSyncExternalStore snapshot.
 */
export function getSlotContributions(name: string): readonly SlotContribution[] {
  const cached = slotSnapshots.get(name)
  if (cached) return cached
  const entries = slots.get(name)
  if (!entries || entries.size === 0) return NO_CONTRIBUTIONS
  const list = Object.freeze(
    [...entries.values()]
      .sort((a, b) => a.order - b.order || a.seq - b.seq)
      .map(({ id, order, component }) => Object.freeze({ id, order, component })),
  )
  slotSnapshots.set(name, list)
  return list
}

/**
 * The slot's first contribution (lowest order). With only a default
 * registration, that is the component passed to `registerSlot(slot, C)`.
 */
export function getSlot(name: string): AnyComponent | undefined {
  return getSlotContributions(name)[0]?.component
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
