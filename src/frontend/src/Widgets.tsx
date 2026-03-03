// Widget components and renderer
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { WidgetConfig } from './types'

// ============ WIDGET COMPONENTS ============

function StatsCardWidget({ props }: { props?: Record<string, unknown> }) {
    const title = (props?.title as string) || 'Statistics'
    const value = (props?.value as string) || '0'
    const change = (props?.change as string) || ''
    const changeType = (props?.changeType as 'positive' | 'negative') || 'positive'

    return (
        <Card className="mb-4">
            <CardHeader className="pb-2">
                <CardDescription>{title}</CardDescription>
                <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
            {change && (
                <CardContent className="pt-0">
                    <span className={changeType === 'positive' ? 'text-green-500 text-sm' : 'text-red-500 text-sm'}>
                        {change}
                    </span>
                </CardContent>
            )}
        </Card>
    )
}

function QuickLinksWidget({ props }: { props?: Record<string, unknown> }) {
    const title = (props?.title as string) || 'Quick Links'
    const links = (props?.links as { label: string; href: string }[]) || []

    return (
        <Card className="mb-4">
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

function NewsletterWidget({ props }: { props?: Record<string, unknown> }) {
    const title = (props?.title as string) || 'Newsletter'
    const buttonText = (props?.buttonText as string) || 'Subscribe'

    return (
        <Card className="mb-4">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <CardDescription>Get the latest updates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                <input
                    type="email"
                    placeholder="Enter your email"
                    className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                />
                <Button size="sm" className="w-full">{buttonText}</Button>
            </CardContent>
        </Card>
    )
}

function HeroBannerWidget({ props }: { props?: Record<string, unknown> }) {
    const title = (props?.title as string) || 'Welcome'
    const subtitle = (props?.subtitle as string) || ''
    const ctaLabel = (props?.ctaLabel as string) || ''
    const ctaHref = (props?.ctaHref as string) || ''

    return (
        <div className="py-16 px-6 text-center bg-gradient-to-br from-primary/10 to-primary/5 mb-6">
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

function CopyrightWidget({ props }: { props?: Record<string, unknown> }) {
    const text = (props?.text as string) || `© ${new Date().getFullYear()}`
    return <div className="text-center text-sm text-muted-foreground py-2">{text}</div>
}

function SocialLinksWidget({ props }: { props?: Record<string, unknown> }) {
    const links = (props?.links as { platform: string; href: string }[]) || []
    return (
        <div className="flex gap-4 justify-center py-2">
            {links.map((link, i) => (
                <a key={i} href={link.href} className="text-muted-foreground hover:text-foreground text-sm">
                    {link.platform}
                </a>
            ))}
        </div>
    )
}

function ProgressWidget({ props }: { props?: Record<string, unknown> }) {
    const label = (props?.label as string) || 'Progress'
    const value = (props?.value as number) || 0
    const showPercent = (props?.showPercent as boolean) !== false

    return (
        <Card className="mb-4">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex justify-between">
                    <span>{label}</span>
                    {showPercent && <span className="text-muted-foreground">{value}%</span>}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                    />
                </div>
            </CardContent>
        </Card>
    )
}

function AnnouncementWidget({ props }: { props?: Record<string, unknown> }) {
    const title = (props?.title as string) || 'Announcement'
    const message = (props?.message as string) || ''
    const type = (props?.type as 'info' | 'warning' | 'success') || 'info'

    const colors = {
        info: 'border-blue-500 bg-blue-500/10',
        warning: 'border-yellow-500 bg-yellow-500/10',
        success: 'border-green-500 bg-green-500/10'
    }

    return (
        <div className={`mb-4 p-4 rounded-lg border-l-4 ${colors[type]}`}>
            <h4 className="font-medium text-sm">{title}</h4>
            {message && <p className="text-sm text-muted-foreground mt-1">{message}</p>}
        </div>
    )
}

function RecentPostsWidget({ props }: { props?: Record<string, unknown> }) {
    const title = (props?.title as string) || 'Recent Posts'
    const posts = (props?.posts as { title: string; href: string; date?: string }[]) || []

    return (
        <Card className="mb-4">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {posts.map((post, i) => (
                    <a key={i} href={post.href} className="block group">
                        <div className="text-sm text-foreground group-hover:text-primary transition-colors">
                            {post.title}
                        </div>
                        {post.date && (
                            <div className="text-xs text-muted-foreground">{post.date}</div>
                        )}
                    </a>
                ))}
            </CardContent>
        </Card>
    )
}

function BadgeListWidget({ props }: { props?: Record<string, unknown> }) {
    const title = (props?.title as string) || 'Tags'
    const badges = (props?.badges as string[]) || []

    return (
        <Card className="mb-4">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
                {badges.map((badge, i) => (
                    <span key={i} className="px-2 py-1 text-xs rounded-full bg-primary/10 text-primary">
                        {badge}
                    </span>
                ))}
            </CardContent>
        </Card>
    )
}

// Widget renderer
function renderZoneWidget(widget: WidgetConfig, index: number) {
    switch (widget.type) {
        case 'StatsCard':
            return <StatsCardWidget key={index} props={widget.props} />
        case 'QuickLinks':
            return <QuickLinksWidget key={index} props={widget.props} />
        case 'Newsletter':
            return <NewsletterWidget key={index} props={widget.props} />
        case 'HeroBanner':
            return <HeroBannerWidget key={index} props={widget.props} />
        case 'Copyright':
            return <CopyrightWidget key={index} props={widget.props} />
        case 'SocialLinks':
            return <SocialLinksWidget key={index} props={widget.props} />
        case 'Progress':
            return <ProgressWidget key={index} props={widget.props} />
        case 'Announcement':
            return <AnnouncementWidget key={index} props={widget.props} />
        case 'RecentPosts':
            return <RecentPostsWidget key={index} props={widget.props} />
        case 'BadgeList':
            return <BadgeListWidget key={index} props={widget.props} />
        case 'Toc':
            return null // Toc is rendered separately
        default:
            return (
                <Card key={index} className="mb-4">
                    <CardContent className="pt-4">
                        <span className="text-muted-foreground text-sm">Widget: {widget.type}</span>
                    </CardContent>
                </Card>
            )
    }
}

export function ZoneWidgets({ widgets }: { widgets?: WidgetConfig[] }) {
    if (!widgets || widgets.length === 0) return null
    return <>{widgets.map((w, i) => renderZoneWidget(w, i))}</>
}
