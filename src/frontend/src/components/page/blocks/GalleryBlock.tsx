/**
 * The `gallery` block: block props to the Gallery template. Registered
 * lazily by blocks/coreBlocks.tsx, in its own chunk. The template does not
 * depend on the block layer, so a React page uses it without the blocks chunk.
 */
import { arr, isRecord, safeUrl, str } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'
import { Gallery, type GalleryItem } from '../Gallery'

/**
 * `{type: "gallery", items: [{src, alt, caption}]}`, plus the template's
 * card fields on any item: `title`, `subtitle`, `tag`, `description`.
 */
export function GalleryBlock({ node }: { node: BlockNode }) {
  const p = node.props ?? {}
  const items: GalleryItem[] = arr(p.items)
    .filter(isRecord)
    .map((it, i) => {
      const src = safeUrl(it.src ?? it.image ?? it.url, 'image')
      const title = str(it.title ?? it.caption ?? it.alt ?? it.name, `Item ${i + 1}`)
      return {
        id: str(it.id, String(i)),
        title,
        subtitle: it.subtitle != null ? str(it.subtitle) : undefined,
        tag: it.tag != null ? str(it.tag) : undefined,
        description: it.description != null ? str(it.description) : undefined,
        image: src ? { src, alt: str(it.alt ?? it.caption, '') } : undefined,
      }
    })
  return <Gallery label={str(p.title ?? p.label, 'Gallery')} items={items} />
}
