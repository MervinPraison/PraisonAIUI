import type { LayoutLoader, LayoutMeta } from '@/sdk/layouts'

/**
 * A built-in layout's browser descriptor: its id, its meta and a loader for
 * its frame chunk (`app-layouts/<id>/`). Eager and tiny: the frame itself
 * loads only when the layout is rendered.
 */
export interface LayoutDescriptor {
  readonly id: string
  readonly meta: LayoutMeta
  readonly load: LayoutLoader
}
