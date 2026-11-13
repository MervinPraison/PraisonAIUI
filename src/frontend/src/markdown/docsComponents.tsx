/**
 * Docs-variant overrides that carry behaviour: heading ids for the TOC and
 * anchors, SPA-normalised internal links, feature-card lists. Styling is
 * Streamdown's defaults plus tokens. (The map is assembled in Markdown.tsx.)
 */
import type { JSX } from 'react'
import { defaultComponents, type ExtraProps } from 'streamdown'
import { cn } from '@/lib/utils'
import { slugify } from './slug'
import { isInternalDocHref, normalizeDocHref } from '../pathUtils'
import { ListUl, PolicyLink } from './chatComponents'
import { hastText, isFeatureList } from './hast'

type Props<K extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[K] & ExtraProps

/** `/docs/x.md` style links become canonical SPA routes (SEO + nav-intercept). */
const docsHref = (href: string): string => (isInternalDocHref(href) ? normalizeDocHref(href) : href)

const docsHeading = (level: 1 | 2 | 3 | 4, cls: string) => {
    const Default = defaultComponents[`h${level}`]
    return function DocsHeading({ className, node, ...rest }: Props<'h1'>) {
        return <Default {...rest} node={node} id={slugify(hastText(node))} className={cn(cls, 'scroll-mt-20', className)} />
    }
}

export const DocsH1 = docsHeading(1, 'mt-10 mb-4 text-3xl font-semibold tracking-tight')
export const DocsH2 = docsHeading(2, 'mt-10 mb-3 text-2xl font-semibold tracking-tight')
export const DocsH3 = docsHeading(3, 'mt-8 mb-2 text-xl font-semibold')
export const DocsH4 = docsHeading(4, 'mt-6 mb-2 text-lg font-semibold')

export function DocsLink(props: Props<'a'>) {
    return <PolicyLink {...props} rewrite={docsHref} />
}

const FEATURE_GRID =
    'aiui-feature-grid my-6 grid list-none grid-cols-1 gap-4 pl-0 md:grid-cols-2 ' +
    '[&>li]:rounded-lg [&>li]:border [&>li]:border-border [&>li]:p-4'

/** MkDocs feature lists render as a two-column card grid, as the React docs always did. */
export function DocsUl({ node, className, ...rest }: Props<'ul'>) {
    if (isFeatureList(node)) {
        const DefaultUl = defaultComponents.ul
        return <DefaultUl {...rest} node={node} className={cn(FEATURE_GRID, className)} />
    }
    return <ListUl {...rest} node={node} className={className} />
}
