/**
 * Widget Registry - Maps widget type names to the components in ./widgets
 */

import React from 'react'
import { Copyright, HeroBanner, Newsletter, QuickLinks, SocialLinks, StatsCard, type WidgetProps } from './widgets'

// ============ WIDGET REGISTRY ============
export const WIDGET_REGISTRY: Record<string, React.ComponentType<WidgetProps>> = {
    StatsCard,
    QuickLinks,
    Newsletter,
    SocialLinks,
    Copyright,
    HeroBanner,
}

/**
 * Renders a widget by type name
 */
export function renderWidget(widget: { type: string; props?: Record<string, unknown> }): React.ReactNode {
    const Widget = WIDGET_REGISTRY[widget.type]
    if (Widget) {
        return <Widget props={widget.props} />
    }
    // Fallback for unknown widget types
    return (
        <div className="p-4 border rounded-lg bg-muted/30">
            <span className="text-muted-foreground text-sm">Unknown widget: {widget.type}</span>
        </div>
    )
}
