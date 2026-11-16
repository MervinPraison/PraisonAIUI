// Docs sidebar: the nav tree, as a sticky column on desktop and a sheet on phones.
// Styles: docs/docs.css (.aiui-docs-sidebar, .aiui-docs-nav*), Pro tokens.
import { useEffect, useRef } from 'react'
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
import { docsChromeModel, isExternal } from './docs/chrome'

interface NavTreeProps {
    nav: DocsNav
    activeItem: string
    onItemClick: (item: NavItem) => void
}

export function NavTree({ nav, activeItem, onItemClick }: NavTreeProps) {
    const renderItem = (item: NavItem, depth = 0) => {
        const key = item.title + (item.path || '')
        if (item.children && item.children.length > 0) {
            return (
                <div key={key} className="aiui-docs-group">
                    <div className="aiui-docs-group-label">{item.title}</div>
                    <div className="aiui-docs-group-items">
                        {item.children.map((child) => renderItem(child, depth + 1))}
                    </div>
                </div>
            )
        }

        const isActive = (item.path || item.title) === activeItem
        const href = canonicalDocPath(item.path || '/')
        return (
            <a
                key={key}
                href={href}
                data-nav-path={item.path || ''}
                aria-current={isActive ? 'page' : undefined}
                className="aiui-docs-navitem"
                style={{ '--depth': Math.max(0, depth - 1) } as React.CSSProperties}
                onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                    event.preventDefault()
                    onItemClick(item)
                }}
            >
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
