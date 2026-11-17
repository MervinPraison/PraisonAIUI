// Card links for docs components (DocsBlocks.tsx).
import { isExternal } from './chrome'
import { resolveDocTarget } from './docSource'

// The div's `value` bypasses the sanitizer's href check, so a card link gets
// the same allowlist as block links: relative, http(s) and mailto only.
const CARD_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** A card's link: external as written, a docs path resolved against the page on screen; undefined for any other scheme (javascript:, data:, ...). */
export function cardHref(target: string): string | undefined {
    try {
        if (!CARD_PROTOCOLS.has(new URL(target.trim(), 'http://docs.invalid/').protocol)) return undefined
    } catch {
        return undefined
    }
    if (isExternal(target) || target.startsWith('#') || /^mailto:/i.test(target)) return target
    const here = typeof window === 'undefined' ? '/docs/index' : window.location.pathname
    return resolveDocTarget(target, here === '/' ? '/docs/index' : here)
}
