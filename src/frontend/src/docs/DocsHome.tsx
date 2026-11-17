/**
 * The docs home page layout: frontmatter `layout: home` on the docs index page
 * (docs/index.md) adds a hero (name, text, tagline, actions, image) and a
 * feature grid above the page's markdown, in the VitePress shape. The compiler
 * reads the frontmatter into ui-config.json `docsHome`; see
 * docs/features/content-sources.md "Home page layout". Feature icons:
 * docsHomeIcons.ts.
 */
import type { MouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DOCS_HOME_ICONS, DocsHomeIcon } from './docsHomeIcons'
import { resolveDocTarget } from './docSource'
import { isExternal } from './chrome'
import type { DocsHomeConfig } from '../types'

/** A frontmatter link as an href: relative targets resolve against the home page, as markdown links do. */
function homeHref(link: string, homePath: string): string {
    return resolveDocTarget(link.trim(), homePath)
}

/**
 * Loading hints for a hero image. The one for the colour mode on screen is
 * the page's largest paint, so it loads first; the other is display: none,
 * so it waits (lazy) until the reader switches mode.
 */
function heroLoading(hidden: boolean): { loading?: 'lazy'; fetchPriority?: 'high' } {
    return hidden ? { loading: 'lazy' } : { fetchPriority: 'high' }
}

interface DocsHomeProps {
    home: DocsHomeConfig
    /** The home page's docs path (`/docs/index`): relative links and images resolve against it. */
    homePath: string
    /** SPA navigation for an internal href. */
    onNavigate: (href: string) => void
}

export function DocsHome({ home, homePath, onNavigate }: DocsHomeProps) {
    const hero = home.hero ?? {}
    const features = home.features ?? []
    // The mode at render; a later switch shows the lazy variant, which then loads.
    const darkNow = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    const follow = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
        if (isExternal(href) || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onNavigate(href)
    }
    const external = (href: string) => (isExternal(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})

    return (
        <section className="aiui-docs-home" aria-label={hero.name || 'Home'}>
            <div className="aiui-docs-hero">
                {hero.name && <h1 className="aiui-docs-hero-name">{hero.name}</h1>}
                {hero.text && <p className="aiui-docs-hero-text">{hero.text}</p>}
                {hero.tagline && <p className="aiui-docs-hero-tagline">{hero.tagline}</p>}
                {!!hero.actions?.length && (
                    <div className="aiui-docs-hero-actions">
                        {hero.actions.map((action) => {
                            const href = homeHref(action.link, homePath)
                            return (
                                <Button key={action.text + href} asChild variant={action.theme === 'alt' ? 'outline' : 'default'}>
                                    <a href={href} onClick={follow(href)} {...external(href)}>
                                        {action.text}
                                    </a>
                                </Button>
                            )
                        })}
                    </div>
                )}
            </div>
            {hero.image && (
                <div className="aiui-docs-hero-media">
                    <img
                        className="aiui-docs-hero-image"
                        data-theme={hero.imageDark ? 'light' : undefined}
                        src={homeHref(hero.image, homePath)}
                        alt={hero.imageAlt ?? ''}
                        {...heroLoading(!!hero.imageDark && darkNow)}
                    />
                    {hero.imageDark && (
                        <img
                            className="aiui-docs-hero-image"
                            data-theme="dark"
                            src={homeHref(hero.imageDark, homePath)}
                            alt={hero.imageAlt ?? ''}
                            {...heroLoading(!darkNow)}
                        />
                    )}
                </div>
            )}
            {features.length > 0 && (
                <ul className="aiui-docs-features">
                    {features.map((feature) => {
                        const icon = feature.icon && DOCS_HOME_ICONS[feature.icon.toLowerCase()] ? feature.icon : null
                        const href = feature.link ? homeHref(feature.link, homePath) : ''
                        return (
                            <li key={feature.title} className="aiui-docs-feature">
                                {icon && (
                                    <span className="aiui-docs-feature-icon">
                                        <DocsHomeIcon name={icon} />
                                    </span>
                                )}
                                <h2 className="aiui-docs-feature-title">{feature.title}</h2>
                                {feature.details && <p className="aiui-docs-feature-details">{feature.details}</p>}
                                {href && (
                                    <a className="aiui-docs-feature-link" href={href} onClick={follow(href)} {...external(href)}>
                                        {feature.linkText || 'Learn more'}
                                        <DocsHomeIcon name="arrow-right" />
                                    </a>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
        </section>
    )
}
