/**
 * The shell sidebar. Hand-built rather than the shadcn `sidebar` component:
 * that one statically imports Sheet and Tooltip, which would put radix Dialog
 * and Popper on the boot path. Here the mobile Sheet is a lazy chunk
 * (MobileNav.tsx) that reuses SidebarNav.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from 'react'
import { ChevronRight, PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import {
  footerPages,
  groupPages,
  isGroupOpen,
  navGroups,
  readGroupState,
  revealInScroller,
  siteLogo,
  siteTitle,
  writeGroupState,
  type NavGroupsConfig,
} from './nav'
import { PageIcon } from './PageIcon'
import { isPlainLeftClick, navigate, pathForPage } from './router'
import { SHELL_SLOTS, Slot } from './Slot'

type TipHandler = (page: ShellPage | null, anchor?: HTMLElement) => void

function NavItem({
  page,
  active,
  collapsed,
  onNavigate,
  onTip,
}: {
  page: ShellPage
  active: boolean
  collapsed: boolean
  onNavigate?: () => void
  onTip?: TipHandler
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
        onPointerEnter={collapsed && onTip ? (e) => onTip(page, e.currentTarget) : undefined}
        onPointerLeave={collapsed && onTip ? () => onTip(null) : undefined}
        onFocus={collapsed && onTip ? (e: FocusEvent<HTMLAnchorElement>) => onTip(page, e.currentTarget) : undefined}
        onBlur={collapsed && onTip ? () => onTip(null) : undefined}
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

/**
 * Grouped page links, footer pages and the `sidebar:footer` slot. Shared by
 * the desktop sidebar and the mobile sheet.
 */
export function SidebarNav({
  pages,
  groupConfig,
  activeId,
  collapsed = false,
  onNavigate,
  className,
}: {
  pages: readonly ShellPage[]
  /** The manifest's `layout.groups` (navGroups()): group order and which start folded. */
  groupConfig?: NavGroupsConfig
  activeId: string
  collapsed?: boolean
  onNavigate?: () => void
  className?: string
}) {
  const groups = useMemo(() => groupPages(pages, groupConfig), [pages, groupConfig])
  const footer = useMemo(() => footerPages(pages), [pages])
  const navRef = useRef<HTMLElement>(null)
  const [folds, setFolds] = useState<Record<string, boolean>>(readGroupState)
  const [tip, setTip] = useState<{ title: string; top: number; left: number } | null>(null)
  const onTip = useCallback<TipHandler>((page, anchor) => {
    if (!page || !anchor) return setTip(null)
    const r = anchor.getBoundingClientRect()
    setTip({ title: page.title, top: r.top + r.height / 2, left: r.right + 8 })
  }, [])
  const toggleGroup = (name: string, open: boolean) => {
    setFolds((cur) => {
      const next = { ...cur, [name]: !open }
      writeGroupState(next)
      return next
    })
  }
  // Keep the current page visible in a long list (deep links, back/forward,
  // collapsing the rail): its group's heading too, so the context shows.
  useEffect(() => {
    const nav = navRef.current
    const el = nav?.querySelector<HTMLElement>('a[aria-current="page"]')
    if (!nav || !el) return
    const heading = collapsed ? null : el.closest('section')?.querySelector<HTMLElement>('[data-group-toggle]')
    revealInScroller(nav, el)
    if (heading) revealInScroller(nav, heading)
  }, [activeId, collapsed])
  // Expanding the rail drops any tooltip left over from collapsed mode.
  // Adjusted during render (not in an effect) to avoid a cascading re-render.
  const [tipCollapsed, setTipCollapsed] = useState(collapsed)
  if (tipCollapsed !== collapsed) {
    setTipCollapsed(collapsed)
    if (!collapsed) setTip(null)
  }
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <nav
        ref={navRef}
        aria-label="Pages"
        onScroll={tip ? () => setTip(null) : undefined}
        // A fade under the brand row: scrolled items never butt against it.
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 [mask-image:linear-gradient(to_bottom,transparent,#000_12px)]"
      >
        {groups.map((group, i) => {
          const hasActive = group.pages.some((p) => p.id === activeId)
          const open = collapsed || isGroupOpen(group.name, hasActive, folds, groupConfig?.folded)
          const listId = `aiui-nav-group-${i}`
          return (
            <section key={group.name} aria-label={group.name}>
              {collapsed ? (
                i > 0 && <div aria-hidden="true" className="mx-2 my-2 h-px bg-sidebar-border" />
              ) : (
                <h2 className="pt-3">
                  <button
                    type="button"
                    data-group-toggle={group.name}
                    aria-expanded={open}
                    aria-controls={listId}
                    disabled={hasActive}
                    onClick={() => toggleGroup(group.name, open)}
                    className="group/grp flex h-7 w-full items-center gap-1 rounded-md px-2.5 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:hover:text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className={cn('size-3.5 opacity-0 group-hover/grp:opacity-100 group-focus-visible/grp:opacity-100 motion-safe:transition-transform motion-safe:duration-[120ms]', open && 'rotate-90', !open && 'opacity-100')}
                    />
                  </button>
                </h2>
              )}
              {open && (
                <ul id={listId} className="flex flex-col gap-px">
                  {group.pages.map((p) => (
                    <NavItem key={p.id} page={p} active={p.id === activeId} collapsed={collapsed} onNavigate={onNavigate} onTip={onTip} />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </nav>
      {collapsed && tip && (
        <div
          role="tooltip"
          aria-hidden="true"
          data-aiui-nav-tip=""
          style={{ top: tip.top, left: tip.left }}
          className="pointer-events-none fixed z-[var(--z-tooltip)] -translate-y-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow-md"
        >
          {tip.title}
        </div>
      )}
      {footer.length > 0 && (
        <ul className="flex shrink-0 flex-col gap-px border-t border-sidebar-border px-2 py-2">
          {footer.map((p) => (
            <NavItem key={p.id} page={p} active={p.id === activeId} collapsed={collapsed} onNavigate={onNavigate} onTip={onTip} />
          ))}
        </ul>
      )}
      <Slot
        name={SHELL_SLOTS.sidebarFooter}
        pageId={activeId}
        page={pages.find((p) => p.id === activeId)}
        extra={{ collapsed }}
        className={cn(
          'flex shrink-0 flex-col gap-1 border-t border-sidebar-border px-2 py-2',
          collapsed && 'items-center',
        )}
      />
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
  const groupConfig = useMemo(() => navGroups(manifest), [manifest])
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
      <SidebarNav pages={manifest.pages} groupConfig={groupConfig} activeId={activeId} collapsed={collapsed} />
    </aside>
  )
}
