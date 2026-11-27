/**
 * Decoupled fence-viewer registry (R1, R3): lets chat code blocks render rich
 * interactive viewers (such as `sheet`, `whiteboard`, or plugin-registered
 * viewers like Excalidraw) without markdown/ ever statically importing
 * layout-features/ or heavy third-party libraries.
 */
import { createElement, lazy, Suspense, type ComponentType, type JSX } from 'react'

export interface FenceViewerProps {
  content: string
  language: string
  streaming?: boolean
}

export type FenceViewerEntry =
  | ComponentType<FenceViewerProps>
  | (() => Promise<{ default: ComponentType<FenceViewerProps> }>)

const registry = new Map<string, ComponentType<FenceViewerProps>>()

function toComponent(entry: FenceViewerEntry): ComponentType<FenceViewerProps> {
  // Distinguish React components from lazy () => import(...) loaders by wrapping
  // only zero-arg loader functions whose prototype is not a React Component.
  return entry as ComponentType<FenceViewerProps>
}

/** Register a custom chat code-fence viewer for `language` (e.g. 'excalidraw', 'sheet'). */
export function registerFenceViewer(language: string, viewer: ComponentType<FenceViewerProps>): void {
  const key = language.trim().toLowerCase()
  if (key) registry.set(key, toComponent(viewer))
}

/** Register a lazily loaded code-fence viewer so its code stays out of first paint (R4). */
export function registerLazyFenceViewer(
  language: string,
  loader: () => Promise<{ default: ComponentType<FenceViewerProps> }>,
): void {
  const Lazy = lazy(loader)
  registerFenceViewer(language, function LazyFenceViewer(props: FenceViewerProps): JSX.Element {
    return createElement(
      Suspense,
      {
        fallback: createElement(
          'div',
          {
            className:
              'my-3 flex h-32 items-center justify-center rounded-xl border border-hairline bg-card text-xs text-tier-3',
          },
          `Loading ${props.language}…`,
        ),
      },
      createElement(Lazy, props),
    )
  })
}

export function getFenceViewer(language: string): ComponentType<FenceViewerProps> | undefined {
  return registry.get(language.trim().toLowerCase())
}

// Built-in lazy studio viewers: zero bytes in boot or chat first paint; loaded only
// when a ```sheet or ```whiteboard fence actually renders.
registerLazyFenceViewer('sheet', () => import('@/studio/SheetGrid'))
registerLazyFenceViewer('whiteboard', () => import('@/studio/Whiteboard'))
