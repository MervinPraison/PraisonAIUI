// Sidebar component — navigation tree
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
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
                <div key={item.title + (item.path || '')}>
                    <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest mt-4 first:mt-0">
                        {item.title}
                    </div>
                    <div className="space-y-0.5">
                        {item.children!.map((child) => renderItem(child, depth + 1))}
                    </div>
                </div>
            )
        }

        return (
            <button
                key={item.title + (item.path || '')}
                type="button"
                onClick={() => onItemClick(item)}
                className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-all duration-150 ${isActive
                    ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                style={{ paddingLeft: `${12 + depth * 12}px` }}
            >
                {item.title}
            </button>
        )
    }

    return (
        <nav className="space-y-0.5">
            {nav.items?.map((group) => renderItem(group))}
        </nav>
    )
}

interface SidebarProps extends NavTreeProps {
    nav: DocsNav
}

export function Sidebar({ nav, activeItem, onItemClick }: SidebarProps) {
    return (
        <aside className="w-64 min-w-[16rem] border-r border-border/50 hidden md:block">
            <ScrollArea className="h-[calc(100vh-4rem)] py-4 px-2">
                <NavTree nav={nav} activeItem={activeItem} onItemClick={onItemClick} />
                <Separator className="my-4" />
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
