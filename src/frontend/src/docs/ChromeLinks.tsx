/**
 * Header links, the primary button and footer socials of the docs chrome.
 * Which network a link stands for: docs/socials.ts. Brand paths live in the
 * lazy docs/brandIcons.ts chunk; an unknown network draws a globe, and
 * website, email, RSS and podcast are lucide icons through docsIcon().
 */
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { docsIcon } from './docsHomeIcons'
import type { ChromeLink } from './chrome'
import { NETWORKS, linkTarget, socialOf } from './socials'
import { formatStars, useGithubStars } from './githubStars'

let paths: Record<string, string> | null = null
let loading: Promise<Record<string, string>> | null = null

/** A brand mark from the lazy chunk: an empty frame of the same size until it arrives. */
function BrandMarkIcon({ network, className }: { network: string; className?: string }) {
    const [loaded, setLoaded] = useState(paths)
    useEffect(() => {
        if (loaded) return
        let live = true
        loading ??= import('./brandIcons').then((m) => (paths = m.default))
        loading.then((p) => live && setLoaded(p)).catch(() => (loading = null))
        return () => void (live = false)
    }, [loaded])
    const d = loaded?.[network]
    return createElement(
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'currentColor', className, 'aria-hidden': true },
        d ? createElement('path', { d }) : null,
    )
}

/** The mark of a network from socialOf() (a globe for an unknown one). */
export function SocialIcon({ network, className }: { network: string; className?: string }): ReactElement | null {
    const n = NETWORKS[network]
    if (!n) return docsIcon('globe', className)
    return n.lucide ? docsIcon(n.lucide, className) : createElement(BrandMarkIcon, { network, className })
}

/** A header link's icon: its `icon`, else its network's mark. */
function LinkMark({ link }: { link: ChromeLink }) {
    if (link.icon) return docsIcon(link.icon, 'aiui-docs-linkicon')
    return link.network ? <SocialIcon network={link.network} className="aiui-docs-linkicon" /> : null
}

/** A header (or drawer) link: icon and label, or the mark alone with the label as its name. */
export function ChromeLinkAnchor({ link }: { link: ChromeLink }) {
    return (
        <a href={link.href} className="aiui-docs-navlink" data-icon-only={link.iconOnly || undefined}
            {...(link.iconOnly ? { 'aria-label': link.label, title: link.label } : {})} {...linkTarget(link.href)}>
            <LinkMark link={link} />
            {!link.iconOnly && link.label}
        </a>
    )
}

/** The primary button's content: its mark, label and (type github) the repository's stars. */
export function PrimaryContent({ link, stars: repo }: { link: ChromeLink; stars?: string }) {
    const stars = useGithubStars(repo)
    return (
        <>
            <LinkMark link={link} />
            {link.label}
            {stars !== null && (
                <span className="aiui-docs-stars">
                    {docsIcon('star', 'aiui-docs-linkicon')}
                    {formatStars(stars)}
                    <span className="sr-only"> stars</span>
                </span>
            )}
        </>
    )
}

/** Footer socials: one mark per network, its name as the link's accessible name. */
export function SocialLinks({ socials }: { socials: Record<string, string> }) {
    const items = Object.entries(socials).filter(([, href]) => Boolean(href))
    if (items.length === 0) return null
    return (
        <ul className="aiui-docs-socials" aria-label="Social links">
            {items.map(([key, href]) => {
                const social = socialOf(key, href)
                return (
                    <li key={key}>
                        <a href={href} aria-label={social.label} title={social.label} {...linkTarget(href)}>
                            <SocialIcon network={social.network} />
                        </a>
                    </li>
                )
            })}
        </ul>
    )
}
