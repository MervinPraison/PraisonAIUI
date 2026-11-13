/**
 * The shell sidebar. Hand-built rather than the shadcn `sidebar` component:
 * that one statically imports Sheet and Tooltip, which would put radix Dialog
 * and Popper on the boot path. Here the mobile Sheet is a lazy chunk
 * (MobileNav.tsx) that reuses SidebarNav.
 */
import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import { footerPages, groupPages, revealInScroller, siteLogo, siteTitle } from './nav'
import { PageIcon } from './PageIcon'
import { isPlainLeftClick, navigate, pathForPage } from './router'

function NavItem({
  page,
  active,
  collapsed,
  onNavigate,
}: {
  page: ShellPage
  active: boolean
  collapsed: boolean
  onNavigate?: () => void
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(e)) return
    e.preventDefault()
    navigate(page.id)
    onNavigate?.()
  }
  return (
    <li>
      <a
        href={pathForPage(page.id)}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? page.title : undefined}
        title={collapsed ? page.title : undefined}
        data-page-id={page.id}
        className={cn(
          'group/nav flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none',
          'transition-colors duration-100 hover:transition-none motion-reduce:transition-none',
          'focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          active
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        <PageIcon
          page={page}
          className={active ? 'text-sidebar-accent-foreground' : 'text-muted-foreground group-hover/nav:text-sidebar-accent-foreground'}
        />
        {!collapsed && <span className="min-w-0 truncate">{page.title}</span>}
      </a>
    </li>
  )
}

/** Grouped page links plus footer pages. Shared by the desktop sidebar and the mobile sheet. */
export function SidebarNav({
  pages,
  activeId,
  collapsed = false,
  onNavigate,
  className,
}: {
  pages: readonly ShellPage[]
  activeId: string
  collapsed?: boolean
  onNavigate?: () => void
  className?: string
}) {
  const groups = useMemo(() => groupPages(pages), [pages])
  const footer = useMemo(() => footerPages(pages), [pages])
  const navRef = useRef<HTMLElement>(null)
  // Keep the current page visible in a long list (deep links, back/forward).
  useEffect(() => {
    const nav = navRef.current
    const el = nav?.querySelector<HTMLElement>('a[aria-current="page"]')
    if (nav && el) revealInScroller(nav, el)
  }, [activeId])
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <nav ref={navRef} aria-label="Pages" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {groups.map((group, i) => (
          <section key={group.name} aria-label={group.name}>
            {collapsed ? (
              i > 0 && <div aria-hidden="true" className="mx-2 my-2 h-px bg-sidebar-border" />
            ) : (
              <h2 className="px-2.5 pt-4 pb-1 text-xs font-medium text-muted-foreground">{group.name}</h2>
            )}
            <ul className="flex flex-col gap-px">
              {group.pages.map((p) => (
                <NavItem key={p.id} page={p} active={p.id === activeId} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </ul>
          </section>
        ))}
      </nav>
      {footer.length > 0 && (
        <ul className="flex shrink-0 flex-col gap-px border-t border-sidebar-border px-2 py-2">
          {footer.map((p) => (
            <NavItem key={p.id} page={p} active={p.id === activeId} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Logo + site title. */
export function SidebarBrand({ manifest, className }: { manifest: ShellManifest; className?: string }) {
  const logo = siteLogo(manifest)
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      {logo?.kind === 'img' && <img src={logo.value} alt="" className="size-5 shrink-0 rounded-sm object-contain" />}
      {logo?.kind === 'text' && (
        <span aria-hidden="true" className="shrink-0 text-base leading-none">
          {logo.value}
        </span>
      )}
      <span className="truncate text-sm font-semibold text-foreground">{siteTitle(manifest)}</span>
    </div>
  )
}

export function AppSidebar({
  manifest,
  activeId,
  collapsed,
  onToggleCollapsed,
  className,
}: {
  manifest: ShellManifest
  activeId: string
  collapsed: boolean
  onToggleCollapsed: () => void
  className?: string
}) {
  return (
    <aside
      aria-label="Sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-aiui-shell-sidebar=""
      className={cn(
        'h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        'transition-[width] duration-150 ease-out motion-reduce:transition-none',
        collapsed ? 'w-13' : 'w-60',
        className,
      )}
    >
      <div className={cn('flex h-12 shrink-0 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        {!collapsed && <SidebarBrand manifest={manifest} className="flex-1" />}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="text-muted-foreground hover:text-foreground"
        >
          <PanelLeft />
        </Button>
      </div>
      <SidebarNav pages={manifest.pages} activeId={activeId} collapsed={collapsed} />
    </aside>
  )
}
