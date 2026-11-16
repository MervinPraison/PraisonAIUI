// Header model the docs header and the phone drawer share: brand, links,
// call to action (from the YAML navbar, logo and header component).
import type { UIConfig } from '../types'

/** Header props from the template's header slot (or the `header` component). */
export function headerProps(config: UIConfig, templateKey = 'docs') {
    const headerSlot = config.templates?.[templateKey]?.slots?.header
    const headerRef = headerSlot?.ref
    const headerComponent = headerRef ? config.components?.[headerRef] : config.components?.header
    return (headerComponent?.props || headerSlot?.props) as {
        logoText?: string
        logoImage?: string
        links?: { label: string; href: string }[]
        cta?: { label: string; href: string }
    } | undefined
}

/** Brand, links and call to action the header and the phone drawer share. */
export function docsChromeModel(config: UIConfig, templateKey = 'docs') {
    const header = headerProps(config, templateKey)
    const logoConfig = config.logo
    const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    const logoSrc = header?.logoImage || (logoConfig ? (isDarkMode ? (logoConfig.dark || logoConfig.light) : (logoConfig.light || logoConfig.dark)) : null)
    const navbar = config.navbar
    return {
        logoSrc,
        logoHref: logoConfig?.href || '/',
        logoText: header?.logoText || config.site?.title || 'PraisonAIUI',
        links: navbar?.links ?? header?.links ?? [],
        primary: navbar?.primary ?? (header?.cta ? { type: 'button' as const, label: header.cta.label, href: header.cta.href } : undefined),
    }
}

/** An absolute http(s) URL: opens in a new tab. */
export function isExternal(href: string) {
    return /^https?:\/\//.test(href)
}
