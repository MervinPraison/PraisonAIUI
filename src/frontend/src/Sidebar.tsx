// Docs sidebar: the nav tree, as a sticky column on desktop and a sheet on phones.
// Styles: docs/docs.css (.aiui-docs-sidebar, .aiui-docs-nav*), Pro tokens.
import { useEffect, useId, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { canonicalDocPath } from './docs/docSource'
import type { DocsNav, NavItem, NavTabConfig, UIConfig } from './types'
import { BrandMark } from './docs/BrandMark'
import { docPages, navItemHolds, navItemShown, rememberedOpen, rememberOpen } from './docs/docNav'
import { docsChromeModel, isExternal } from './docs/chrome'
import { withBase } from './lib/url'
import { DOCS_HOME_ICONS, DocsHomeIcon } from './docs/docsHomeIcons'

interface NavTreeProps {
    nav: DocsNav
    activeItem: string
    onItemClick: (item: NavItem) => void
}

/** A group's or page's sidebar icon (`icon:` in the nav YAML or the page's frontmatter); unknown names draw nothing. */
function NavIcon({ name }: { name?: string }) {
    if (!name || !DOCS_HOME_ICONS[name.toLowerCase()]) return null
    return (
        <span className="aiui-docs-navicon">
            <DocsHomeIcon name={name} />
        </span>
    )
}

/** A plain click (no modifier, main button): the app navigates in place. */
const plainClick = (event: React.MouseEvent) => !(event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)

interface NavGroupProps extends Omit<NavTreeProps, 'nav'> {
    item: NavItem
    groupKey: string // its titles from the top, joined by "/": where its open state is remembered
    collapsible: boolean
    drilldown: boolean
    children: React.ReactNode
}

/** A sidebar group: a label (a link to its own `root` page, or with drilldown to its first page) that folds its pages. */
function NavGroup({ item, groupKey, activeItem, collapsible, drilldown, onItemClick, children }: NavGroupProps) {
    const holdsActive = navItemHolds(item, activeItem)
    const [open, setOpen] = useState(() => holdsActive || (rememberedOpen(groupKey) ?? item.expanded !== false))
    // Moving to a page inside the group opens it (state adjusted while rendering, not in an effect).
    const [heldActive, setHeldActive] = useState(holdsActive)
    if (heldActive !== holdsActive) {
        setHeldActive(holdsActive)
        if (holdsActive) setOpen(true)
    }
    const itemsId = useId()
    const shown = !collapsible || open
    const toggle = (next: boolean) => (setOpen(next), rememberOpen(groupKey, next))
    const target = item.path ? item : drilldown ? docPages({ items: item.children ?? [] })[0] : undefined
    const label = (
        <>
            <NavIcon name={item.icon} />
            <span className="aiui-docs-group-title">{item.title}</span>
            {item.tag && <span className="aiui-docs-navtag">{item.tag}</span>}
        </>
    )
    const chevron = <ChevronRight className="aiui-docs-group-chevron" aria-hidden="true" />
    return (
        <div className="aiui-docs-group" data-open={shown ? '' : undefined}>
            <div className="aiui-docs-group-label">
                {target ? (
                    <a href={withBase(canonicalDocPath(target.path || '/'))} data-nav-path={target.path || ''}
                        aria-current={item.path && item.path === activeItem ? 'page' : undefined}
                        onClick={(event) => {
                            if (!plainClick(event)) return
                            event.preventDefault()
                            if (collapsible) toggle(true)
                            onItemClick(target)
                        }}
                    >
                        {label}
                    </a>
                ) : collapsible ? (
                    <button type="button" aria-expanded={open} aria-controls={itemsId} onClick={() => toggle(!open)}>
                        {label}
                        {chevron}
                    </button>
                ) : (
                    label
                )}
                {target && collapsible && (
                    <button type="button" className="aiui-docs-group-chevbtn" aria-expanded={open} aria-controls={itemsId}
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${item.title}`} onClick={() => toggle(!open)}>
                        {chevron}
                    </button>
                )}
            </div>
            <div id={itemsId} className="aiui-docs-group-items" hidden={!shown}>
                {children}
            </div>
        </div>
    )
}

export function NavTree({ nav, activeItem, onItemClick }: NavTreeProps) {
    const collapsible = nav.collapsible !== false
    const drilldown = nav.drilldown === true
    const renderItem = (item: NavItem, depth = 0, trail = ''): React.ReactNode => {
        const key = item.title + (item.path || '')
        if (!navItemShown(item)) return null
        if (item.children && item.children.length > 0) {
            const groupKey = trail ? `${trail}/${item.title}` : item.title
            return (
                <NavGroup key={key} item={item} groupKey={groupKey} activeItem={activeItem}
                    collapsible={collapsible} drilldown={drilldown} onItemClick={onItemClick}>
                    {item.children.map((child) => renderItem(child, depth + 1, groupKey))}
                </NavGroup>
            )
        }

        const isActive = (item.path || item.title) === activeItem
        const href = withBase(canonicalDocPath(item.path || '/'))
        return (
            <a
                key={key}
                href={href}
                data-nav-path={item.path || ''}
                aria-current={isActive ? 'page' : undefined}
                className="aiui-docs-navitem"
                style={{ '--depth': Math.max(0, depth - 1) } as React.CSSProperties}
                onClick={(event) => {
                    if (!plainClick(event)) return
                    event.preventDefault()
                    onItemClick(item)
                }}
            >
                <NavIcon name={item.icon} />
                {item.title}
            </a>
        )
    }

    return <nav className="aiui-docs-nav" aria-label="Documentation">{nav.items?.map((group) => renderItem(group))}</nav>
}

/** Scroll a nav column so its active page shows (the column only, never the page). */
function revealActive(box: HTMLElement | null) {
    const el = box?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!box || !el) return
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTop = Math.max(0, top - box.clientHeight / 3)
    }
}

function useActiveInView(activeItem: string) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => revealActive(ref.current), [activeItem])
    return ref
}

export function Sidebar({ nav, activeItem, onItemClick }: NavTreeProps) {
    const scrollRef = useActiveInView(activeItem)
    return (
        <aside className="aiui-docs-sidebar docs-sidebar">
            <div ref={scrollRef} className="aiui-docs-sidebar-scroll">
                <NavTree nav={nav} activeItem={activeItem} onItemClick={onItemClick} />
            </div>
        </aside>
    )
}

interface MobileNavSheetProps extends NavTreeProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title?: string
    config?: UIConfig
    templateKey?: string
    navTabs?: NavTabConfig[]
    activeTabIndex?: number
    onTabChange?: (index: number) => void
}

export function MobileNavSheet({
    open,
    onOpenChange,
    nav,
    activeItem,
    onItemClick,
    title = 'Navigation',
    config,
    templateKey,
    navTabs = [],
    activeTabIndex = 0,
    onTabChange,
}: MobileNavSheetProps) {
    const chrome = config ? docsChromeModel(config, templateKey) : null
    const scrollRef = useRef<HTMLDivElement>(null)
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="left"
                className="aiui-docs aiui-docs-drawer p-0"
                // The sheet mounts in a portal: reveal the active page once it is laid out.
                onOpenAutoFocus={() => requestAnimationFrame(() => revealActive(scrollRef.current))}
            >
                <SheetHeader className="aiui-docs-drawer-head">
                    <BrandMark name={chrome?.logoText ?? title} src={chrome?.logoSrc} />
                    <SheetTitle className="truncate text-sm">{title}</SheetTitle>
                    <SheetDescription className="sr-only">Documentation pages</SheetDescription>
                </SheetHeader>
                <div ref={scrollRef} className="aiui-docs-drawer-body">
                    {navTabs.length > 1 && (
                        <div className="aiui-docs-drawer-tabs" role="group" aria-label="Documentation sections">
                            {navTabs.map((tab, index) => (
                                <button
                                    key={tab.tab}
                                    type="button"
                                    aria-pressed={index === activeTabIndex}
                                    onClick={() => onTabChange?.(index)}
                                >
                                    {tab.tab}
                                </button>
                            ))}
                        </div>
                    )}
                    <NavTree
                        nav={nav}
                        activeItem={activeItem}
                        onItemClick={(item) => {
                            onItemClick(item)
                            onOpenChange(false)
                        }}
                    />
                </div>
                {chrome && (chrome.primary || chrome.links.length > 0) && (
                    <div className="aiui-docs-drawer-foot">
                        {chrome.links.map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                className="aiui-docs-navlink"
                                target={isExternal(link.href) ? '_blank' : undefined}
                                rel={isExternal(link.href) ? 'noopener noreferrer' : undefined}
                            >
                                {link.label}
                            </a>
                        ))}
                        {chrome.primary && (
                            <Button asChild size="sm" className="ml-auto">
                                <a href={chrome.primary.href}>{chrome.primary.label ?? 'Get started'}</a>
                            </Button>
                        )}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    )
}
