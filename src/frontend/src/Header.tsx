// Docs header: brand, section tabs, links, search, call to action, theme.
// Styles: docs/docs.css (.aiui-docs-header*), Pro tokens.
import { Menu, Search, Sparkles } from 'virtual:aiui-icons/inline'
import type { UIConfig } from './types'
import type { NavDivisions } from './docs/navDivisions'
import { HeaderTabs, LanguageSwitcher } from './docs/DivisionNav'
import { LocaleSwitcher } from './i18n'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { BrandMark } from './docs/BrandMark'
import { docsChromeModel, isAppPath, type ChromeLink } from './docs/chrome'
import { ChromeLinkAnchor, PrimaryContent } from './docs/ChromeLinks'
import { linkTarget } from './docs/socials'
import { withBase } from './lib/url'

interface HeaderProps {
    config: UIConfig
    templateKey?: string
    onMenuClick?: () => void
    /** Tabs (and tab menus) from ui-config `navigation`; App.tsx builds them (docs/navDivisions.ts). */
    divisions?: NavDivisions
    /** Shows the search button; App.tsx passes it when search is on. */
    onSearchClick?: () => void
    /** Opens Ask AI (docs/AskAi.tsx), when the site has it. */
    onAskClick?: () => void
}

/** The navbar links (wide screens; phones list them in the drawer). */
function SiteLinks({ links }: { links: ChromeLink[] }) {
    if (links.length === 0) return null
    return (
        <nav className="aiui-docs-links" aria-label="Site">
            {links.map((link) => (
                <ChromeLinkAnchor key={link.href + link.label} link={link} />
            ))}
        </nav>
    )
}

export function Header({
    config,
    templateKey = 'docs',
    onMenuClick,
    divisions,
    onSearchClick,
    onAskClick,
}: HeaderProps) {
    const { logoSrc, logoDarkSrc, logoHref, logoText, links, primary } = docsChromeModel(config, templateKey)
    // An app path navigates in place; any other href (another site) is a plain link.
    const inApp = isAppPath(logoHref)
    const hasTabs = (divisions?.tabs.length ?? 0) > 0
    const searchEnabled = Boolean(onSearchClick)

    const onLogoClick = (event: React.MouseEvent) => {
        if (!inApp || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
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

                <a href={inApp ? withBase(logoHref) : logoHref} className="aiui-docs-brand" onClick={onLogoClick}>
                    <BrandMark name={logoText} src={logoSrc} darkSrc={logoDarkSrc} />
                    <span>{logoText}</span>
                </a>

                {hasTabs && divisions && <HeaderTabs divisions={divisions} />}

                {!hasTabs && <SiteLinks links={links} />}

                <div className="flex-1 min-w-0" />

                {searchEnabled && (
                    <button type="button" className="aiui-docs-search" onClick={openSearch} aria-label="Search documentation">
                        <Search aria-hidden="true" />
                        <span>{config.search?.prompt || 'Search docs'}</span>
                        <kbd className="aiui-docs-kbd">⌘K</kbd>
                    </button>
                )}

                <div className="aiui-docs-actions">
                    {hasTabs && <SiteLinks links={links} />}

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

                    {onAskClick && (
                        <Button type="button" variant="ghost" size="sm" className="aiui-docs-ask-button" onClick={onAskClick}
                            aria-label="Ask AI" title="Ask AI (⌘I)">
                            <Sparkles aria-hidden="true" />
                            <span>Ask AI</span>
                        </Button>
                    )}

                    {primary && (
                        <Button asChild size="sm" className="aiui-docs-cta">
                            <a href={primary.href} {...linkTarget(primary.href)}>
                                <PrimaryContent link={primary} stars={primary.stars} />
                            </a>
                        </Button>
                    )}

                    {!config.site?.theme?.strict && <ThemeToggle />}
                    {divisions?.languages?.length ? <LanguageSwitcher divisions={divisions} /> : <LocaleSwitcher />}
                </div>
            </div>
        </header>
    )
}
