// Header component — Mintlify-style docs chrome
import { Github, Menu, Search } from 'lucide-react'
import type { NavTabConfig, UIConfig } from './types'
import { LocaleSwitcher } from './i18n'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'

interface HeaderProps {
    config: UIConfig
    templateKey?: string
    onMenuClick?: () => void
    navTabs?: NavTabConfig[]
    activeTabIndex?: number
    onTabChange?: (index: number) => void
}

export function Header({
    config,
    templateKey = 'docs',
    onMenuClick,
    navTabs,
    activeTabIndex = 0,
    onTabChange,
}: HeaderProps) {
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
    const logoText = header?.logoText || config.site?.title || 'PraisonAIUI'

    const tabs = navTabs ?? config.navigation?.tabs ?? []
    const navbar = config.navbar
    const navbarLinks = navbar?.links ?? header?.links ?? []
    const primary = navbar?.primary ?? (header?.cta ? { type: 'button' as const, label: header.cta.label, href: header.cta.href } : undefined)
    const showMintlifyNav = tabs.length > 0

    const onLogoClick = (event: React.MouseEvent) => {
        event.preventDefault()
        window.history.pushState({}, '', logoHref)
        window.dispatchEvent(new CustomEvent('aiui:navigate', { detail: { path: logoHref } }))
    }

    const onSearchClick = () => {
        window.dispatchEvent(new CustomEvent('aiui:search-open'))
    }

    return (
        <header
            className="sticky top-0 z-50 border-b border-border/40 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75"
            data-aiui-header-tabs={showMintlifyNav ? 'true' : undefined}
        >
            <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
                {onMenuClick && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="md:hidden shrink-0 -ml-1"
                        onClick={onMenuClick}
                        aria-label="Open navigation menu"
                    >
                        <Menu className="h-5 w-5" />
                    </Button>
                )}

                <a
                    href={logoHref}
                    className="flex items-center gap-2.5 group cursor-pointer shrink-0 min-w-0"
                    onClick={onLogoClick}
                >
                    {logoSrc ? (
                        <img
                            src={logoSrc}
                            alt="Logo"
                            className="h-7 w-7 rounded-md object-contain"
                        />
                    ) : (
                        <div className="h-7 w-7 rounded-md bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center">
                            <span className="text-primary-foreground text-[10px] font-bold">AI</span>
                        </div>
                    )}
                    <span className="font-semibold text-[15px] tracking-tight truncate hidden sm:inline">{logoText}</span>
                </a>

                {showMintlifyNav && (
                    <nav className="hidden md:flex items-center gap-1 ml-2" aria-label="Primary docs sections">
                        {tabs.map((tab, index) => (
                            <button
                                key={tab.tab}
                                type="button"
                                onClick={() => onTabChange?.(index)}
                                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${index === activeTabIndex
                                    ? 'text-foreground font-medium'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                {tab.tab}
                            </button>
                        ))}
                    </nav>
                )}

                {!showMintlifyNav && (
                    <nav className="hidden md:flex items-center gap-1 flex-1 ml-2">
                        {navbarLinks.map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/50"
                            >
                                {link.label}
                            </a>
                        ))}
                    </nav>
                )}

                <div className="flex-1 min-w-0" />

                {config.search?.enabled !== false && showMintlifyNav && (
                    <button
                        type="button"
                        onClick={onSearchClick}
                        className="hidden sm:flex items-center gap-2 h-9 w-full max-w-[220px] px-3 text-sm text-muted-foreground border border-border/60 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                        aria-label="Search documentation"
                    >
                        <Search className="h-4 w-4 shrink-0" />
                        <span className="flex-1 text-left truncate">Search...</span>
                        <kbd className="hidden lg:inline text-[10px] font-medium text-muted-foreground/80 border border-border/60 rounded px-1.5 py-0.5">⌘K</kbd>
                    </button>
                )}

                <div className="flex items-center gap-1.5 shrink-0">
                    {showMintlifyNav && navbarLinks.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="hidden lg:inline-flex px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {link.label}
                        </a>
                    ))}

                    {primary && (
                        <a
                            href={primary.href}
                            target={primary.href.startsWith('http') ? '_blank' : undefined}
                            rel={primary.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground h-9 px-3.5 hover:bg-primary/90 transition-colors"
                        >
                            {primary.type === 'github' && <Github className="h-4 w-4" />}
                            {primary.label ?? (primary.type === 'github' ? 'GitHub' : 'Get started')}
                        </a>
                    )}

                    <ThemeToggle />
                    <LocaleSwitcher />
                </div>
            </div>
        </header>
    )
}
