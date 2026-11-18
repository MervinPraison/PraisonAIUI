/**
 * Page frontmatter the docs article acts on (docs-nav.json, compiler/nav_builder.py
 * page_fields): the title and description at the top, the page `mode`, and the
 * custom keys (`meta`) as data attributes.
 */
import type { NavItem } from '../types'

/** Modes that drop "On this page": wide, center, custom and frame. */
export const modeHidesToc = (mode?: string) => !!mode

/** Modes that draw only the article (no breadcrumb, footer or pager): custom and frame. */
export const modeIsBare = (mode?: string) => mode === 'custom' || mode === 'frame'

const FENCE = /^\s*(`{3,}|~{3,})/

/** Plain text as one Markdown paragraph (no emphasis, links, HTML or math). */
function plain(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[\\`*_[\]<>|~$&]/g, '\\$&')
        .replace(/^([#>+=-]|\d+[.)])/, '\\$1')
}

const words = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()

/**
 * The page head Mintlify draws from frontmatter: a `#` title when the body has
 * none, and with `lede` the description as the paragraph under the title
 * (unless that paragraph already says it).
 */
export function withPageHead(md: string, item: Pick<NavItem, 'title' | 'pageTitle' | 'description' | 'lede'>): string {
    const description = item.lede ? item.description?.trim() : ''
    const lines = md.split('\n')
    let fence: string | null = null
    let h1 = -1
    for (const [i, line] of lines.entries()) {
        const f = FENCE.exec(line)
        if (f) fence = fence ? (f[1][0] === fence[0] ? null : fence) : f[1]
        else if (!fence && /^#\s+\S/.test(line)) {
            h1 = i
            break
        }
    }
    const lede = description ? `${plain(description)}\n\n` : ''
    if (h1 < 0) return `# ${plain(item.pageTitle ?? item.title)}\n\n${lede}${md}`
    if (!lede) return md
    const next = lines.slice(h1 + 1).find((line) => line.trim())
    if (next && words(next).startsWith(words(description!).slice(0, 60))) return md
    return [...lines.slice(0, h1 + 1), '', lede.trimEnd(), ...lines.slice(h1 + 1)].join('\n')
}

/** `data-fm-<key>` attributes for the article from the page's custom frontmatter keys (`productVersion` -> `data-fm-product-version`). */
export function metaAttributes(meta: NavItem['meta']): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(meta ?? {})) {
        out[`data-fm-${key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase()}`] = String(value)
    }
    return out
}
