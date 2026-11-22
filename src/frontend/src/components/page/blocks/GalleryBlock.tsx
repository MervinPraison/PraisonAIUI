/**
 * The `gallery` block: block props to the Gallery template. Registered
 * lazily by blocks/coreBlocks.tsx, in its own chunk. The template does not
 * depend on the block layer, so a React page uses it without the blocks chunk.
 */
import { pageLinkProps } from '@/blocks/mediaModel'
import { arr, isRecord, safeUrl, str } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'
import { Gallery, type GalleryItem } from '../Gallery'

/**
 * `{type: "gallery", items: [{src, alt, caption}]}`, plus the template's
 * card fields on any item: `title`, `subtitle`, `tag`, `description`, and a
 * link: `href` (+ `target`), `page` (an app page id, opened in place) or
 * `video` (a video URL; opens in a new tab unless `target` says otherwise).
 */
export function GalleryBlock({ node }: { node: BlockNode }) {
  const p = node.props ?? {}
  const items: GalleryItem[] = arr(p.items)
    .filter(isRecord)
    .map((it, i) => {
      const src = safeUrl(it.src ?? it.image ?? it.url, 'image')
      const title = str(it.title ?? it.caption ?? it.alt ?? it.name, `Item ${i + 1}`)
      const video = safeUrl(it.video)
      const page = str(it.page)
      const nav = page ? pageLinkProps(page) : undefined
      const href = nav?.href ?? safeUrl(it.href) ?? video
      const target = nav ? undefined : str(it.target) || (href && href === video ? '_blank' : undefined)
      return {
        id: str(it.id, String(i)),
        title,
        subtitle: it.subtitle != null ? str(it.subtitle) : undefined,
        tag: it.tag != null ? str(it.tag) : undefined,
        description: it.description != null ? str(it.description) : undefined,
        image: src ? { src, alt: str(it.alt ?? it.caption, '') } : undefined,
        href,
        target,
        onOpen: nav?.onClick,
        video: video !== undefined || it.kind === 'video',
      }
    })
  return <Gallery label={str(p.title ?? p.label, 'Gallery')} items={items} />
}
