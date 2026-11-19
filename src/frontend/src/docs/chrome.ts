// Header model the docs header and the phone drawer share: brand, links,
// call to action (from the YAML navbar, logo and header component).
import type { NavbarLinkConfig, UIConfig } from '../types'
import { withBase } from '../lib/url'

/** Header props from the template's header slot (or the `header` component). */
export function headerProps(config: UIConfig, templateKey = 'docs') {
    const headerSlot = config.templates?.[templateKey]?.slots?.header
    const headerRef = headerSlot?.ref
    const headerComponent = headerRef ? config.components?.[headerRef] : config.components?.header
    return (headerComponent?.props || headerSlot?.props) as {
        logoText?: string
        logoImage?: string
        links?: NavbarLinkConfig[]
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
        links: (navbar?.links ?? header?.links ?? []).map(chromeLink),
        primary: primary && {
            ...chromeLink({ ...primary, type: primary.type === 'button' ? undefined : primary.type }),
            label: primary.label ?? (primary.type === 'github' ? 'GitHub' : primary.type === 'discord' ? 'Discord' : 'Get started'),
            iconOnly: false,
            stars: primary.type === 'github' ? primary.href : undefined,
        },
    }
}

/** A header link ready to draw: `network` from `type`, whose name is the label when none is given (`iconOnly`: the mark alone). */
export type ChromeLink = { label: string; href: string; icon?: string; network?: 'github' | 'discord'; iconOnly?: boolean }

const NETWORK_LABELS = { github: 'GitHub', discord: 'Discord' } as const

function chromeLink({ label, href, icon, type: network }: NavbarLinkConfig): ChromeLink {
    const name = label || (network ? NETWORK_LABELS[network] : href)
    return { label: name, href: withBase(href), icon, network, iconOnly: Boolean(network && !label) }
}

/** A path in this app (`/x`, not `//host` or `https://`): the header navigates to it in place. */
export function isAppPath(href: string) {
    return /^\/(?!\/)/.test(href)
}

/** An absolute http(s) URL: opens in a new tab. */
export function isExternal(href: string) {
    return /^https?:\/\//.test(href)
}
