// Sidebar component — Mintlify-style navigation tree
import { ChevronRight } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import { normalizeDocPath } from './pathUtils'
import type { DocsNav, NavItem } from './types'

interface NavTreeProps {
    nav: DocsNav
    activeItem: string
    onItemClick: (item: NavItem) => void
}

export function NavTree({ nav, activeItem, onItemClick }: NavTreeProps) {
    const renderItem = (item: NavItem, depth = 0) => {
        const isActive = (item.path || item.title) === activeItem
        const hasChildren = item.children && item.children.length > 0

        if (hasChildren) {
            return (
                <div key={item.title + (item.path || '')} className="mb-4">
                    <div className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
                        {item.title}
                    </div>
                    <div className="space-y-0.5 mt-1">
                        {item.children!.map((child) => renderItem(child, depth + 1))}
                    </div>
                </div>
            )
        }

        const href = normalizeDocPath(item.path || '/')

        return (
            <a
                key={item.title + (item.path || '')}
                href={href}
                data-nav-path={item.path || ''}
                onClick={(event) => {
                    event.preventDefault()
                    onItemClick(item)
                }}
                className={`group flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-[13px] rounded-md transition-colors ${isActive
                    ? 'text-primary font-medium bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    }`}
                style={{ paddingLeft: `${12 + depth * 10}px` }}
            >
                {depth > 0 && (
                    <ChevronRight className={`h-3 w-3 shrink-0 opacity-0 group-hover:opacity-40 ${isActive ? 'opacity-60 text-primary' : ''}`} />
                )}
                <span className="truncate">{item.title}</span>
            </a>
        )
    }

    return (
        <nav className="space-y-0.5 pb-6">
            {nav.items?.map((group) => renderItem(group))}
        </nav>
    )
}

interface SidebarProps extends NavTreeProps {
    nav: DocsNav
}

export function Sidebar({ nav, activeItem, onItemClick }: SidebarProps) {
    return (
        <aside className="docs-sidebar w-[17rem] min-w-[17rem] shrink-0 hidden md:block border-r border-border/40">
            <ScrollArea className="h-[calc(100vh-3.5rem)] sticky top-14">
                <div className="py-5 px-2">
                    <NavTree nav={nav} activeItem={activeItem} onItemClick={onItemClick} />
                </div>
            </ScrollArea>
        </aside>
    )
}

interface MobileNavSheetProps extends NavTreeProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title?: string
}

export function MobileNavSheet({ open, onOpenChange, nav, activeItem, onItemClick, title = 'Navigation' }: MobileNavSheetProps) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="left" className="w-72 p-0">
                <SheetHeader className="border-b px-4 py-3">
                    <SheetTitle>{title}</SheetTitle>
                </SheetHeader>
                <ScrollArea className="h-[calc(100vh-4rem)] px-2 py-4">
                    <NavTree
                        nav={nav}
                        activeItem={activeItem}
                        onItemClick={(item) => {
                            onItemClick(item)
                            onOpenChange(false)
                        }}
                    />
                </ScrollArea>
            </SheetContent>
        </Sheet>
    )
}
