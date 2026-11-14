/** Small hast helpers shared by the markdown components. */
import type { Element as HastElement, ElementContent, Root as HastRoot } from 'hast'

/** Text content of a hast node (headings containing `code`, links, emphasis). */
export function hastText(node?: HastElement | ElementContent): string {
    if (!node) return ''
    if (node.type === 'text') return node.value
    if (node.type === 'element') return node.children.map(hastText).join('')
    return ''
}

function hasStrong(node: HastElement | ElementContent): boolean {
    return node.type === 'element' && (node.tagName === 'strong' || node.children.some(hasStrong))
}

/**
 * MkDocs "feature" lists (`- :material-x: **Title**: text`, the grid-cards
 * idiom): the first item has bold text. Same heuristic the React docs used
 * before Streamdown (mkdocsEnhance), now decided on the hast so it survives
 * re-renders.
 */
export function isFeatureList(node?: HastElement): boolean {
    const first = node?.children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'li')
    if (!first) return false
    const text = hastText(first)
    return text.includes('YAML-Driven') || text.includes('Component Slots') || hasStrong(first)
}

/** The footnote section's label id, which remark-rehype hard-codes (no clobberPrefix). */
const FOOTNOTE_LABEL = 'footnote-label'

/**
 * rehype plugin, after sanitize: give the footnote label id (and the
 * aria-describedby that points at it) the renderer instance's prefix, so two
 * messages with footnotes never share an id. Footnote ids and hrefs are
 * prefixed by remark-rehype's clobberPrefix; this label is the one it misses.
 */
export function rehypeFootnoteLabel(prefix: string) {
    const label = prefix + FOOTNOTE_LABEL
    const walk = (node: HastRoot | ElementContent) => {
        if (node.type === 'element') {
            const p = node.properties
            if (p.id === FOOTNOTE_LABEL) p.id = label
            const by = p.ariaDescribedBy
            if (Array.isArray(by) && by.includes(FOOTNOTE_LABEL)) p.ariaDescribedBy = by.map((v) => (v === FOOTNOTE_LABEL ? label : v))
        }
        if ('children' in node) for (const c of node.children) walk(c as ElementContent)
    }
    return (tree: HastRoot) => walk(tree)
}
