/**
 * Widget Registry - Maps widget type names to React components
 */

import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface WidgetProps {
    props?: Record<string, unknown>
}

// ============ STATS CARD WIDGET ============
export function StatsCard({ props }: WidgetProps) {
    const title = (props?.title as string) || 'Statistics'
    const value = (props?.value as string) || '0'
    const change = (props?.change as string) || ''
    const changeType = (props?.changeType as 'positive' | 'negative') || 'positive'

    return (
        <Card className="widget-stats-card">
            <CardHeader className="pb-2">
                <CardDescription>{title}</CardDescription>
                <CardTitle className="text-3xl">{value}</CardTitle>
            </CardHeader>
            {change && (
                <CardContent>
                    <span className={changeType === 'positive' ? 'text-green-500' : 'text-red-500'}>
                        {change}
                    </span>
                </CardContent>
            )}
        </Card>
    )
}

// ============ QUICK LINKS WIDGET ============
export function QuickLinks({ props }: WidgetProps) {
    const title = (props?.title as string) || 'Quick Links'
    const links = (props?.links as { label: string; href: string }[]) || []

    return (
        <Card className="widget-quick-links">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
                {links.map((link, i) => (
                    <a
                        key={i}
                        href={link.href}
                        className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {link.label}
                    </a>
                ))}
            </CardContent>
        </Card>
    )
}

// ============ NEWSLETTER WIDGET ============
export function Newsletter({ props }: WidgetProps) {
    const title = (props?.title as string) || 'Newsletter'
    const placeholder = (props?.placeholder as string) || 'Enter your email'
    const buttonText = (props?.buttonText as string) || 'Subscribe'

    return (
        <Card className="widget-newsletter">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <CardDescription>Get the latest updates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                <input
                    type="email"
                    placeholder={placeholder}
                    className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                />
                <Button size="sm" className="w-full">{buttonText}</Button>
            </CardContent>
        </Card>
    )
}

// ============ SOCIAL LINKS WIDGET ============
export function SocialLinks({ props }: WidgetProps) {
    const links = (props?.links as { platform: string; href: string }[]) || []

    return (
        <div className="widget-social-links flex gap-4 justify-center py-4">
            {links.map((link, i) => (
                <a
                    key={i}
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {link.platform}
                </a>
            ))}
        </div>
    )
}

// ============ COPYRIGHT WIDGET ============
export function Copyright({ props }: WidgetProps) {
    const text = (props?.text as string) || `© ${new Date().getFullYear()}`

    return (
        <div className="widget-copyright text-center text-sm text-muted-foreground py-4">
            {text}
        </div>
    )
}

// ============ HERO BANNER WIDGET ============
export function HeroBanner({ props }: WidgetProps) {
    const title = (props?.title as string) || 'Welcome'
    const subtitle = (props?.subtitle as string) || ''
    const ctaLabel = (props?.ctaLabel as string) || ''
    const ctaHref = (props?.ctaHref as string) || ''

    return (
        <div className="widget-hero-banner py-16 px-6 text-center bg-gradient-to-br from-primary/10 to-primary/5">
            <h1 className="text-4xl font-bold mb-4">{title}</h1>
            {subtitle && <p className="text-xl text-muted-foreground mb-6">{subtitle}</p>}
            {ctaLabel && ctaHref && (
                <Button size="lg" asChild>
                    <a href={ctaHref}>{ctaLabel}</a>
                </Button>
            )}
        </div>
    )
}

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

export default WIDGET_REGISTRY
