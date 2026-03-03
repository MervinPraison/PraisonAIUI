// Header component
import type { UIConfig } from './types'

export function Header({ config }: { config: UIConfig }) {
    // Resolve header component via template slot ref (e.g., header_main)
    const headerSlot = config.templates?.docs?.slots?.header
    const headerRef = headerSlot?.ref
    const headerComponent = headerRef
        ? config.components?.[headerRef]
        : config.components?.header
    const header = (headerComponent?.props || headerSlot?.props) as {
        logoText?: string
        links?: { label: string; href: string }[]
        cta?: { label: string; href: string }
    } | undefined

    return (
        <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
            <div className="max-w-screen-2xl mx-auto flex h-16 items-center px-6 gap-8">
                <a href="/" className="flex items-center gap-3 group cursor-pointer" onClick={(e) => {
                    e.preventDefault()
                    window.history.pushState({}, '', '/')
                    window.location.reload()
                }}>
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-shadow">
                        <span className="text-primary-foreground text-xs font-bold">AI</span>
                    </div>
                    <span className="font-semibold text-lg tracking-tight">{header?.logoText || config.site?.title || 'PraisonAIUI'}</span>
                </a>

                <nav className="hidden md:flex items-center gap-1 flex-1">
                    {header?.links?.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/50"
                        >
                            {link.label}
                        </a>
                    ))}
                </nav>

                <div className="flex items-center gap-2">
                    {header?.cta && (
                        <a
                            href={header.cta.href}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow h-9 px-4 hover:bg-primary/90 transition-colors"
                        >
                            {header.cta.label}
                        </a>
                    )}
                </div>
            </div>
        </header>
    )
}
