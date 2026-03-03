// Sidebar component — navigation tree
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { NavItem } from './types'

interface SidebarProps {
    nav: { items?: NavItem[] }
    activeItem: string
    onItemClick: (item: NavItem) => void
}

export function Sidebar({ nav, activeItem, onItemClick }: SidebarProps) {
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
        <aside className="w-64 min-w-[16rem] border-r border-border/50 hidden md:block">
            <ScrollArea className="h-[calc(100vh-4rem)] py-4 px-2">
                <nav className="space-y-0.5">
                    {nav.items?.map((group) => renderItem(group))}
                </nav>
                <Separator className="my-4" />
            </ScrollArea>
        </aside>
    )
}
