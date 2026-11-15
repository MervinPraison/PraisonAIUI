/**
 * Gallery page template (ProGallery.dc.html): category tabs with counts, a
 * search row, an optional featured slot, a card grid and a details drawer
 * that pushes the grid (non-modal). Cards carry a monogram or an image, a
 * type tag, a two-line description, stats, an action and an error line.
 *
 * Used by React pages directly, and by the `gallery` block (GalleryBlock
 * below, registered lazily by blocks/coreBlocks.tsx; same props as
 * `aiui.gallery()`).
 */
import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { monogram, stepTab } from './model'
import { Glyph } from './parts'
import './page.css'

export interface GalleryItem {
  id: string
  title: string
  /** Publisher or version line under the title. */
  subtitle?: ReactNode
  /** Small type tag ("Agent", "Tool"). */
  tag?: string
  description?: ReactNode
  /** An image (safe URL) instead of the monogram tile. */
  image?: { src: string; alt: string }
  /** Overrides the monogram letters. */
  mono?: string
  stats?: ReactNode
  /** The card's button (Install, Installed, Update). */
  action?: ReactNode
  /** Right of the action ("Free", "Verified"). */
  note?: ReactNode
  error?: string
}

export interface GalleryTab {
  id: string
  label: string
  count?: number
}

export interface GalleryProps {
  /** Accessible name of the grid ("Most installed"). */
  label: string
  items: readonly GalleryItem[]
  tabs?: readonly GalleryTab[]
  activeTab?: string
  onTab?: (id: string) => void
  /** Search, filters and sort, under the tabs. */
  toolbar?: ReactNode
  /** The featured section, above the grid. */
  featured?: ReactNode
  /** Visible heading over the grid (defaults to none; `label` names it). */
  heading?: ReactNode
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  /** Drawer content for the selected item. */
  detail?: ReactNode
  detailTitle?: string
  empty?: ReactNode
  className?: string
}

export function Gallery({
  label,
  items,
  tabs,
  activeTab,
  onTab,
  toolbar,
  featured,
  heading,
  selectedId,
  onSelect,
  detail,
  detailTitle,
  empty,
  className,
}: GalleryProps) {
  const headingId = useId()
  const tabIds = tabs?.map((t) => t.id) ?? []
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!activeTab) return
    const next = stepTab(tabIds, activeTab, e.key)
    if (next === activeTab) return
    e.preventDefault()
    onTab?.(next)
    e.currentTarget.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next)}"]`)?.focus()
  }
  const showDrawer = selectedId != null && detail != null
  return (
    <div className={['aiui-tpl aiui-tpl-gallery', className].filter(Boolean).join(' ')} data-aiui-template="gallery">
      <div className="aiui-tpl-gallery-main">
        {tabs && tabs.length > 0 && (
          <div role="tablist" aria-label="Category" className="aiui-tpl-gtabs" onKeyDown={onTabKey}>
            {tabs.map((t) => {
              const on = t.id === activeTab
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  data-tab-id={t.id}
                  className="aiui-tpl-gtab"
                  onClick={() => onTab?.(t.id)}
                >
                  {t.label}
                  {t.count != null && <span>{t.count.toLocaleString()}</span>}
                </button>
              )
            })}
          </div>
        )}
        {toolbar && (
          <div role="search" className="aiui-tpl-toolbar" data-flat="true">
            {toolbar}
          </div>
        )}
        {featured && <section className="aiui-tpl-featured">{featured}</section>}
        <section aria-labelledby={heading ? headingId : undefined} aria-label={heading ? undefined : label}>
          {heading && (
            <h2 id={headingId} className="aiui-tpl-gallery-h">
              {heading}
            </h2>
          )}
          {items.length === 0 ? (
            <div className="aiui-tpl-empty">{empty ?? 'Nothing to show.'}</div>
          ) : (
            <ul className="aiui-tpl-grid">
              {items.map((item) => (
                <li key={item.id}>
                  <GalleryTile item={item} selected={item.id === selectedId} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {showDrawer && (
        <aside className="aiui-tpl-drawer" aria-label={detailTitle ?? 'Details'}>
          <div className="aiui-tpl-detail-head">
            <span className="aiui-tpl-meta aiui-tpl-grow">{detailTitle ?? 'Details'}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Close details" title="Close details (Esc)" onClick={() => onSelect?.(null)}>
              <Glyph name="close" />
            </Button>
          </div>
          <div
            className="aiui-tpl-detail-body"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onSelect?.(null)
            }}
          >
            {detail}
          </div>
        </aside>
      )}
    </div>
  )
}

function GalleryTile({ item, selected, onSelect }: { item: GalleryItem; selected: boolean; onSelect?: (id: string | null) => void }) {
  const titleId = useId()
  return (
    <article className="aiui-tpl-tile" aria-labelledby={titleId} data-selected={selected || undefined}>
      {item.image && <img className="aiui-tpl-tile-media" src={item.image.src} alt={item.image.alt} loading="lazy" />}
      <div className="aiui-tpl-tile-head">
        {!item.image && (
          <span className="aiui-tpl-mono" aria-hidden="true">
            {item.mono ?? monogram(item.title)}
          </span>
        )}
        <div className="aiui-tpl-tile-title">
          <h3 id={titleId}>
            {onSelect ? (
              <button type="button" aria-pressed={selected} onClick={() => onSelect(selected ? null : item.id)}>
                {item.title}
              </button>
            ) : (
              item.title
            )}
          </h3>
          {item.subtitle != null && <span>{item.subtitle}</span>}
        </div>
        {item.tag && <span className="aiui-tpl-tag">{item.tag}</span>}
      </div>
      {item.description != null && <p className="aiui-tpl-tile-desc">{item.description}</p>}
      {item.stats != null && <div className="aiui-tpl-tile-stats">{item.stats}</div>}
      {item.error && (
        <div className="aiui-tpl-tile-error">
          <CircleAlert aria-hidden width={14} height={14} />
          <span role="alert">{item.error}</span>
        </div>
      )}
      {(item.action != null || item.note != null) && (
        <div className="aiui-tpl-tile-foot">
          {item.action}
          <span className="aiui-tpl-grow" />
          {item.note}
        </div>
      )}
    </article>
  )
}

export default Gallery
