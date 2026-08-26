// Header component
import { Menu } from 'lucide-react'
import type { UIConfig } from './types'
import { LocaleSwitcher } from './i18n'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'

export function Header({
    config,
    templateKey = 'docs',
    onMenuClick,
}: {
    config: UIConfig
    templateKey?: string
    onMenuClick?: () => void
}) {
    const headerSlot = config.templates?.[templateKey]?.slots?.header
    const headerRef = headerSlot?.ref
    const headerComponent = headerRef
        ? config.components?.[headerRef]
        : config.components?.header
    const header = (headerComponent?.props || headerSlot?.props) as {
        logoText?: string
        logoImage?: string
        links?: { label: string; href: string }[]
        cta?: { label: string; href: string }
    } | undefined

    const logoConfig = config.logo
    const isDarkMode = document.documentElement.classList.contains('dark')
    const logoSrc = header?.logoImage || (logoConfig ? (isDarkMode ? (logoConfig.dark || logoConfig.light) : (logoConfig.light || logoConfig.dark)) : null)
    const logoHref = logoConfig?.href || '/'

    return (
        <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
            <div className="max-w-screen-2xl mx-auto flex h-16 items-center px-6 gap-4">
                {onMenuClick && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="md:hidden shrink-0"
                        onClick={onMenuClick}
                        aria-label="Open navigation menu"
                    >
                        <Menu className="h-5 w-5" />
                    </Button>
                )}

                <a href={logoHref} className="flex items-center gap-3 group cursor-pointer min-w-0" onClick={(e) => {
                    e.preventDefault()
                    window.history.pushState({}, '', logoHref)
                    window.location.reload()
                }}>
                    {logoSrc ? (
                        <img
                            src={logoSrc}
                            alt="Logo"
                            className="w-8 h-8 rounded-lg shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-shadow object-contain"
                        />
                    ) : (
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-shadow">
                            <span className="text-primary-foreground text-xs font-bold">AI</span>
                        </div>
                    )}
                    <span className="font-semibold text-lg tracking-tight truncate">{header?.logoText || config.site?.title || 'PraisonAIUI'}</span>
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

                <div className="flex items-center gap-2 ml-auto">
                    <ThemeToggle />
                    <LocaleSwitcher />
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
