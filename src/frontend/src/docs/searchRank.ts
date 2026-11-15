// Search ranking for the docs search dialog (DocsSearch.tsx, a lazy chunk).
/**
 * Search rank of a page for a query (0 hides it): title prefix > a word of
 * the title starts with it > title contains it > section contains it.
 * Every word of a multi-word query must match.
 */
export function scoreDocMatch(title: string, section: string, query: string): number {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return 1
    const t = title.toLowerCase()
    const s = section.toLowerCase()
    let total = 0
    for (const w of words) {
        if (t.startsWith(w)) total += 1
        else if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) total += 0.8
        else if (t.includes(w)) total += 0.6
        else if (s.includes(w)) total += 0.3
        else return 0
    }
    return total / words.length
}
