/**
 * FlexibleLayout - WordPress-style widget zones layout
 * 
 * Zones:
 * - header: Top header area
 * - topNav: Navigation bar below header
 * - hero: Hero section for landing pages
 * - leftSidebar: Left navigation/widgets
 * - main: Main content area
 * - rightSidebar: Right sidebar widgets
 * - bottomNav: Bottom navigation/pagination
 * - footer: Footer area
 */

import React from 'react'

interface WidgetConfig {
    type: string
    props?: Record<string, unknown>
}

interface ZonesConfig {
    header?: WidgetConfig[]
    topNav?: WidgetConfig[]
    hero?: WidgetConfig[]
    leftSidebar?: WidgetConfig[]
    main?: WidgetConfig[]
    rightSidebar?: WidgetConfig[]
    bottomNav?: WidgetConfig[]
    footer?: WidgetConfig[]
}

interface FlexibleLayoutProps {
    zones?: ZonesConfig
    children?: React.ReactNode
    renderWidget?: (widget: WidgetConfig) => React.ReactNode
}

/**
 * Renders a zone with multiple widgets
 */
function Zone({
    widgets,
    className,
    renderWidget
}: {
    widgets?: WidgetConfig[]
    className?: string
    renderWidget?: (widget: WidgetConfig) => React.ReactNode
}) {
    if (!widgets || widgets.length === 0) return null

    return (
        <div className={className}>
            {widgets.map((widget, index) => (
                <div key={`${widget.type}-${index}`} className="widget">
                    {renderWidget ? renderWidget(widget) : (
                        <div className="p-4 border rounded-lg bg-card">
                            <span className="text-muted-foreground text-sm">
                                Widget: {widget.type}
                            </span>
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
}

export function FlexibleLayout({ zones, children, renderWidget }: FlexibleLayoutProps) {
    const hasLeftSidebar = zones?.leftSidebar && zones.leftSidebar.length > 0
    const hasRightSidebar = zones?.rightSidebar && zones.rightSidebar.length > 0

    return (
        <div className="flexible-layout min-h-screen flex flex-col">
            {/* Header Zone */}
            <Zone
                widgets={zones?.header}
                className="zone-header border-b"
                renderWidget={renderWidget}
            />

            {/* Top Nav Zone */}
            <Zone
                widgets={zones?.topNav}
                className="zone-top-nav border-b bg-muted/30"
                renderWidget={renderWidget}
            />

            {/* Hero Zone */}
            <Zone
                widgets={zones?.hero}
                className="zone-hero"
                renderWidget={renderWidget}
            />

            {/* Main Content Area with Sidebars */}
            <div className="flex-1 flex">
                {/* Left Sidebar */}
                {hasLeftSidebar && (
                    <aside className="zone-left-sidebar w-64 border-r p-4 hidden md:block">
                        <Zone
                            widgets={zones?.leftSidebar}
                            className="space-y-4"
                            renderWidget={renderWidget}
                        />
                    </aside>
                )}

                {/* Main Content */}
                <main className={`zone-main flex-1 p-6 ${!hasLeftSidebar && !hasRightSidebar ? 'max-w-4xl mx-auto' : ''}`}>
                    <Zone
                        widgets={zones?.main}
                        className="space-y-4"
                        renderWidget={renderWidget}
                    />
                    {children}
                </main>

                {/* Right Sidebar */}
                {hasRightSidebar && (
                    <aside className="zone-right-sidebar w-64 border-l p-4 hidden lg:block">
                        <Zone
                            widgets={zones?.rightSidebar}
                            className="space-y-4"
                            renderWidget={renderWidget}
                        />
                    </aside>
                )}
            </div>

            {/* Bottom Nav Zone */}
            <Zone
                widgets={zones?.bottomNav}
                className="zone-bottom-nav border-t bg-muted/30"
                renderWidget={renderWidget}
            />

            {/* Footer Zone */}
            <Zone
                widgets={zones?.footer}
                className="zone-footer border-t bg-muted/50"
                renderWidget={renderWidget}
            />
        </div>
    )
}

export default FlexibleLayout
