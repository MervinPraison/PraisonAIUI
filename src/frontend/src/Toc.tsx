// Table of Contents & right sidebar component
import type { NavItem, ZonesConfig } from './types'
import { ZoneWidgets } from './Widgets'

export function Toc({ selectedItem, zones }: { selectedItem: NavItem | null; zones?: ZonesConfig }) {
    const rightSidebarWidgets = zones?.rightSidebar || []

    return (
        <aside className="w-64 hidden lg:block border-l border-border/50">
            <div className="sticky top-20 px-4 py-6 space-y-4">
                {/* Table of Contents */}
                <div>
                    <h4 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest mb-4">
                        On this page
                    </h4>
                    <nav className="space-y-2 text-sm">
                        {selectedItem ? (
                            <div className="space-y-2">
                                <a href="#" className="flex items-center gap-2 text-primary font-medium">
                                    <span className="w-1 h-1 rounded-full bg-primary" />
                                    {selectedItem.title}
                                </a>
                                <a href="#overview" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors pl-3">
                                    Overview
                                </a>
                                <a href="#usage" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors pl-3">
                                    Usage
                                </a>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <a href="#theme" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                                    <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                                    Theme Configuration
                                </a>
                                <a href="#presets" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                                    <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                                    Available Presets
                                </a>
                            </div>
                        )}
                    </nav>
                </div>

                {/* Zone Widgets (excluding Toc) */}
                {rightSidebarWidgets.filter(w => w.type !== 'Toc').length > 0 && (
                    <div className="pt-4 border-t border-border/50">
                        <ZoneWidgets widgets={rightSidebarWidgets.filter(w => w.type !== 'Toc')} />
                    </div>
                )}
            </div>
        </aside>
    )
}
