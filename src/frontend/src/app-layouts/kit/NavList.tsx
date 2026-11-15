/**
 * Navigation links for layout frames, over LayoutNav items (ADR 0003).
 * Pro spec: 32 px rows (44 px on touch), 8 px radius, 14 px text (15 px on
 * touch), the active row on `sidebar-accent` with medium weight and its icon
 * in the accent. Icons come from the item's `navIcon` (./pageIcons) unless the
 * frame passes `renderIcon`.
 */
import type { ReactNode } from 'react'
import type { LayoutNavItem } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { NavIcon } from './pageIcons'
import { isPlainLeftClick, navRowClass, type KitSize } from './rows'

export interface NavListProps {
  items: readonly LayoutNavItem[]
  /** LayoutNav.go */
  go(pageId: string): void
  /** After a navigation (a phone sheet closes itself). */
  onNavigate?(pageId: string): void
  size?: KitSize
  renderIcon?(item: LayoutNavItem): ReactNode
  /** Count shown at the row end (`item.badge` otherwise). */
  badge?(item: LayoutNavItem): number | undefined
  className?: string
  'aria-label'?: string
}

export function NavList({ items, go, onNavigate, size = 'default', renderIcon, badge, className, ...rest }: NavListProps) {
  if (items.length === 0) return null
  return (
    <ul className={cn('m-0 flex list-none flex-col gap-0.5 p-0', className)} aria-label={rest['aria-label']}>
      {items.map((item) => {
        const count = badge ? badge(item) : item.badge
        return (
          <li key={item.id}>
            <a
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              data-aiui-nav-item={item.id}
              className={navRowClass(size, item.active)}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return
                e.preventDefault()
                go(item.id)
                onNavigate?.(item.id)
              }}
            >
              {renderIcon ? renderIcon(item) : <NavIcon item={item} className={cn(item.active && 'text-primary')} />}
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {count ? (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-label={`${count} new`}>
                  {count}
                </span>
              ) : null}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** A titled block of a frame's sidebar ("More", "Recent chats"). */
export function NavSection({
  title,
  children,
  folded,
  size = 'default',
  className,
}: {
  title: string
  children: ReactNode
  /** Start collapsed (a `<details>` the viewer opens); omit for a plain section. */
  folded?: boolean
  size?: KitSize
  className?: string
}) {
  const heading = cn('px-2 font-medium text-muted-foreground', size === 'touch' ? 'text-[13px]' : 'text-xs')
  if (folded === undefined) {
    return (
      <section className={cn('flex min-h-0 flex-col gap-1', className)}>
        <h2 className={cn(heading, 'm-0 py-1')}>{title}</h2>
        {children}
      </section>
    )
  }
  return (
    <details open={!folded} className={cn('flex flex-col gap-1', className)}>
      <summary className={cn(heading, 'cursor-pointer list-none rounded-md py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
        {title}
      </summary>
      {children}
    </details>
  )
}
