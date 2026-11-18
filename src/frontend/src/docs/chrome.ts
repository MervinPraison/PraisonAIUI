// Header model the docs header and the phone drawer share: brand, links,
// call to action (from the YAML navbar, logo and header component).
import type { UIConfig } from '../types'
import { withBase } from '../lib/url'

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

/** Brand, links and call to action the header and the phone drawer share. URLs carry the base path, except logoHref (an app path the header navigates to). */
export function docsChromeModel(config: UIConfig, templateKey = 'docs') {
    const header = headerProps(config, templateKey)
    const logoConfig = config.logo
    // Both variants render and CSS shows the one for the current mode, so a theme switch swaps them with no re-render.
    const logoSrc = header?.logoImage || logoConfig?.light || logoConfig?.dark
    const logoDark = !header?.logoImage && logoConfig?.dark !== logoSrc ? logoConfig?.dark : null
    const navbar = config.navbar
    const primary = navbar?.primary ?? (header?.cta ? { type: 'button' as const, label: header.cta.label, href: header.cta.href } : undefined)
    return {
        logoSrc: logoSrc && withBase(logoSrc),
        logoDarkSrc: logoDark && withBase(logoDark),
        logoHref: logoConfig?.href || '/',
        logoText: header?.logoText || config.site?.title || 'PraisonAIUI',
        links: (navbar?.links ?? header?.links ?? []).map((link) => ({ ...link, href: withBase(link.href) })),
        primary: primary && { ...primary, href: withBase(primary.href) },
    }
}

/** A path in this app (`/x`, not `//host` or `https://`): the header navigates to it in place. */
export function isAppPath(href: string) {
    return /^\/(?!\/)/.test(href)
}

/** An absolute http(s) URL: opens in a new tab. */
export function isExternal(href: string) {
    return /^https?:\/\//.test(href)
}
