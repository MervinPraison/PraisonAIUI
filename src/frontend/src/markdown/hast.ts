/** Small hast helpers shared by the markdown components. */
import type { Element as HastElement, ElementContent } from 'hast'

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
