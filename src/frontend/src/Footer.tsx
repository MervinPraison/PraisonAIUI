// Docs footer: optional link columns (YAML `footer.links`), then the brand
// line, the footer component's links and the `footer.socials` marks. Styles: docs/docs.css (.aiui-docs-footer*).
import type { UIConfig } from './types'
import { BrandMark } from './docs/BrandMark'
import { isExternal } from './docs/chrome'
import { withBase } from './lib/url'
import { SocialLinks } from './docs/ChromeLinks'

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
    const external = isExternal(href)
    return (
        <a href={withBase(href)} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
            {children}
        </a>
    )
}

export function Footer({ config, templateKey = 'docs' }: { config: UIConfig; templateKey?: string }) {
    const footerSlot = config.templates?.[templateKey]?.slots?.footer
    const footerRef = footerSlot?.ref
    const footerComponent = footerRef
        ? config.components?.[footerRef]
        : config.components?.footer
    const footer = (footerComponent?.props || footerSlot?.props) as {
        text?: string
        links?: { label: string; href: string }[]
    } | undefined

    const columns = (config.footer?.links ?? []).filter((col) => col.items?.length)
    const bottomLinks = footer?.links ?? []
    const siteName = config.site?.title || 'PraisonAIUI'

    return (
        <footer className="aiui-docs-footer">
            <div className="aiui-docs-footer-inner">
                {columns.length > 0 && (
                    <div className="aiui-docs-footer-cols">
                        {columns.map((col, i) => (
                            <div key={i} className="aiui-docs-footer-col">
                                {col.header && <h2>{col.header}</h2>}
                                <ul>
                                    {col.items.map((item) => (
                                        <li key={item.href + item.label}>
                                            <FooterLink href={item.href}>{item.label}</FooterLink>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
                <div className="aiui-docs-footer-bottom">
                    <span className="aiui-docs-footer-brand">
                        <BrandMark name={siteName} size="sm" />
                        <span>{footer?.text || `\u00A9 ${new Date().getFullYear()} ${siteName}`}</span>
                    </span>
                    {bottomLinks.length > 0 && (
                        <nav aria-label="Footer">
                            {bottomLinks.map((link) => (
                                <FooterLink key={link.href + link.label} href={link.href}>
                                    {link.label}
                                </FooterLink>
                            ))}
                        </nav>
                    )}
                    {config.footer?.socials && <SocialLinks socials={config.footer.socials} />}
                </div>
            </div>
        </footer>
    )
}
