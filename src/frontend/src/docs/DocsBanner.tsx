/**
 * The `banner:` strip above the docs header: Markdown content in a tone
 * (info, warning, success), and a close button when `dismissible`. A closed
 * banner stays closed for its content (ui-config `banner.id`, a hash of it);
 * new content shows again. Styles: docs/docs.css (.aiui-docs-banner).
 */
import { useState, type AnchorHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import type { BannerConfig } from '../types'
import { Markdown } from '../markdown/LazyMarkdown'
import { withBase } from '../lib/url'
import { isAppPath } from './chrome'
import { linkTarget } from './socials'

const KEY = 'aiui-banner-dismissed'

/** The closed banner's id, or null (no storage, nothing closed). */
function dismissedId(): string | null {
    try {
        return window.localStorage.getItem(KEY)
    } catch {
        return null
    }
}

/** Banner links: a site path keeps the base path, another site opens in a new tab. */
function BannerLink({ href = '', ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
    return <a {...props} href={isAppPath(href) ? withBase(href) : href} {...linkTarget(href)} />
}
const COMPONENTS = { a: BannerLink }

export function DocsBanner({ banner }: { banner?: BannerConfig }) {
    const [closed, setClosed] = useState(() => Boolean(banner?.dismissible && dismissedId() === banner.id))
    if (!banner?.content || closed) return null
    const close = () => {
        setClosed(true)
        try {
            window.localStorage.setItem(KEY, banner.id)
        } catch { /* blocked storage: closed for this visit only */ }
    }
    return (
        <div className="aiui-docs-banner" data-type={banner.type ?? 'info'} role="region" aria-label="Announcement">
            <Markdown variant="docs" className="aiui-docs-banner-text" components={COMPONENTS}>
                {banner.content}
            </Markdown>
            {banner.dismissible && (
                <button type="button" className="aiui-docs-banner-close" onClick={close} aria-label="Dismiss announcement">
                    <X aria-hidden="true" />
                </button>
            )}
        </div>
    )
}
