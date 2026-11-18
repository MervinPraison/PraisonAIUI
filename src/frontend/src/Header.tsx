// Docs header: brand, section tabs, links, search, call to action, theme.
// Styles: docs/docs.css (.aiui-docs-header*), Pro tokens.
import { Github, Menu, Search } from 'lucide-react'
import type { NavTabConfig, UIConfig } from './types'
import { LocaleSwitcher } from './i18n'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { BrandMark } from './docs/BrandMark'
import { docsChromeModel, isExternal } from './docs/chrome'
import { withBase } from './lib/url'

interface HeaderProps {
    config: UIConfig
    templateKey?: string
    onMenuClick?: () => void
    navTabs?: NavTabConfig[]
    activeTabIndex?: number
    onTabChange?: (index: number) => void
    /** Shows the search button; App.tsx passes it when search is on. */
    onSearchClick?: () => void
}

export function Header({
    config,
    templateKey = 'docs',
    onMenuClick,
    navTabs,
    activeTabIndex = 0,
    onTabChange,
    onSearchClick,
}: HeaderProps) {
    const { logoSrc, logoHref, logoText, links, primary } = docsChromeModel(config, templateKey)
    const tabs = navTabs ?? config.navigation?.tabs ?? []
    const hasTabs = tabs.length > 0
    const searchEnabled = Boolean(onSearchClick)

    const onLogoClick = (event: React.MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        window.history.pushState({}, '', withBase(logoHref))
        window.dispatchEvent(new CustomEvent('aiui:navigate', { detail: { path: logoHref } }))
    }

    const openSearch = () => onSearchClick?.()

    return (
        <header className="aiui-docs-header" data-aiui-header-tabs={hasTabs ? 'true' : undefined}>
            <div className="aiui-docs-header-inner">
                {onMenuClick && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="md:hidden -ml-1"
                        onClick={onMenuClick}
                        aria-label="Open navigation menu"
                    >
                        <Menu />
                    </Button>
                )}

                <a href={withBase(logoHref)} className="aiui-docs-brand" onClick={onLogoClick}>
                    <BrandMark name={logoText} src={logoSrc} />
                    <span>{logoText}</span>
                </a>

                {hasTabs && (
                    <nav className="aiui-docs-tabs" aria-label="Documentation sections">
                        {tabs.map((tab, index) => (
                            <button
                                key={tab.tab}
                                type="button"
                                className="aiui-docs-tab"
                                aria-pressed={index === activeTabIndex}
                                onClick={() => onTabChange?.(index)}
                            >
                                {tab.tab}
                            </button>
                        ))}
                    </nav>
                )}

                {!hasTabs && links.length > 0 && (
                    <nav className="aiui-docs-links" aria-label="Site">
                        {links.map((link) => (
                            <a key={link.href} href={link.href} className="aiui-docs-navlink">
                                {link.label}
                            </a>
                        ))}
                    </nav>
                )}

                <div className="flex-1 min-w-0" />

                {searchEnabled && (
                    <button type="button" className="aiui-docs-search" onClick={openSearch} aria-label="Search documentation">
                        <Search aria-hidden="true" />
                        <span>{config.search?.prompt || 'Search docs'}</span>
                        <kbd className="aiui-docs-kbd">⌘K</kbd>
                    </button>
                )}

                <div className="aiui-docs-actions">
                    {hasTabs && links.length > 0 && (
                        <nav className="aiui-docs-links" aria-label="Site">
                            {links.map((link) => (
                                <a
                                    key={link.href}
                                    href={link.href}
                                    className="aiui-docs-navlink"
                                    target={isExternal(link.href) ? '_blank' : undefined}
                                    rel={isExternal(link.href) ? 'noopener noreferrer' : undefined}
                                >
                                    {link.label}
                                </a>
                            ))}
                        </nav>
                    )}

                    {searchEnabled && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="aiui-docs-search-icon"
                            onClick={openSearch}
                            aria-label="Search documentation"
                        >
                            <Search />
                        </Button>
                    )}

                    {primary && (
                        <Button asChild size="sm" className="aiui-docs-cta">
                            <a
                                href={primary.href}
                                target={isExternal(primary.href) ? '_blank' : undefined}
                                rel={isExternal(primary.href) ? 'noopener noreferrer' : undefined}
                            >
                                {primary.type === 'github' && <Github />}
                                {primary.label ?? (primary.type === 'github' ? 'GitHub' : 'Get started')}
                            </a>
                        </Button>
                    )}

                    <ThemeToggle />
                    <LocaleSwitcher />
                </div>
            </div>
        </header>
    )
}
