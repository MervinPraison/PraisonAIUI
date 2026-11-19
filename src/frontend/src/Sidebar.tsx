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
import type { DocsNav, NavItem, UIConfig } from './types'
import type { NavDivisions } from './docs/navDivisions'
import { SidebarDivisions } from './docs/DivisionNav'
import { BrandMark } from './docs/BrandMark'
import { docPages, navItemHolds, navItemShown, rememberedOpen, rememberOpen } from './docs/docNav'
import { docsChromeModel, isExternal } from './docs/chrome'
import { withBase } from './lib/url'
import { docsIcon } from './docs/docsHomeIcons'

interface NavTreeProps {
    nav: DocsNav
    activeItem: string
    onItemClick: (item: NavItem) => void
}

/** A group's or page's sidebar icon (`icon:` in the nav YAML or the page's frontmatter); unknown names draw nothing. */
function NavIcon({ name }: { name?: string }) {
    const icon = docsIcon(name)
    return icon && <span className="aiui-docs-navicon">{icon}</span>
}

/** The badge after a label: its `tag`, or "Deprecated" for a deprecated page. */
function NavTag({ item }: { item: NavItem }) {
    const tag = item.tag || (item.deprecated ? 'Deprecated' : '')
    return tag ? <span className="aiui-docs-navtag">{tag}</span> : null
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
    // Each move to a page inside the group opens it (state adjusted while rendering, not in an effect).
    const [seenActive, setSeenActive] = useState(activeItem)
    if (seenActive !== activeItem) {
        setSeenActive(activeItem)
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
            <NavTag item={item} />
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

        const style = { '--depth': Math.max(0, depth - 1) } as React.CSSProperties
        if (item.href && !item.path) {
            // A link, not a page (frontmatter `url:`, a `{label, href}` nav entry).
            const external = isExternal(item.href)
            return (
                <a key={key} href={withBase(item.href)} className="aiui-docs-navitem" style={style}
                    target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
                    <NavIcon name={item.icon} />
                    {item.title}
                    <NavTag item={item} />
                    {external && docsIcon('arrow-up-right', 'aiui-docs-navext')}
                    {external && <span className="sr-only"> (opens in a new tab)</span>}
                </a>
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
                data-deprecated={item.deprecated ? '' : undefined}
                style={style}
                onClick={(event) => {
                    if (!plainClick(event)) return
                    event.preventDefault()
                    onItemClick(item)
                }}
            >
                <NavIcon name={item.icon} />
                <span className="aiui-docs-navlabel">{item.title}</span>
                <NavTag item={item} />
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

export function Sidebar({ nav, activeItem, onItemClick, divisions }: NavTreeProps & { divisions?: NavDivisions }) {
    const scrollRef = useActiveInView(activeItem)
    return (
        <aside className="aiui-docs-sidebar docs-sidebar">
            <div ref={scrollRef} className="aiui-docs-sidebar-scroll">
                {divisions && <SidebarDivisions divisions={divisions} />}
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
    divisions?: NavDivisions
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
    divisions,
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
                    <BrandMark name={chrome?.logoText ?? title} src={chrome?.logoSrc} darkSrc={chrome?.logoDarkSrc} />
                    <SheetTitle className="truncate text-sm">{title}</SheetTitle>
                    <SheetDescription className="sr-only">Documentation pages</SheetDescription>
                </SheetHeader>
                <div ref={scrollRef} className="aiui-docs-drawer-body">
                    {divisions && <SidebarDivisions divisions={divisions} drawer />}
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
