// Search ranking for the docs search dialog (DocsSearch.tsx, a lazy chunk):
// words, a light English stemmer, forgiving word matches and the title rank.

/** Words a question carries that say nothing about the page ("how do I install" → "install"). */
const STOP = new Set('a an and are can do does for how i in is it of on or the to what when where why with'.split(' '))

/** Lower-case words of `text` (letters and digits in any script). */
export function tokenize(text: string): string[] {
    return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/** The words of a query that matter: stop words go unless the query is only stop words. */
export function queryTerms(query: string): string[] {
    const all = tokenize(query)
    const kept = all.filter((w) => !STOP.has(w))
    return kept.length ? kept : all
}

/** A light English stem: plurals, -ing, -ed and a final e go ("themes", "theming" → "them"). */
export function stem(word: string): string {
    let w = word
    if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`
    else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2)
    else if (w.length > 4 && /(?:s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2)
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
    return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w
}

/** Whether `a` and `b` differ by at most one edit (insert, delete, replace or swap of neighbours). */
function oneEdit(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 1) return false
    let i = 0
    while (i < a.length && a[i] === b[i]) i++
    if (i === a.length && i === b.length) return true
    const tail = (x: number, y: number) => a.slice(x) === b.slice(y)
    if (a.length === b.length) return tail(i + 1, i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && tail(i + 2, i + 2))
    return a.length > b.length ? tail(i + 1, i) : tail(i, i + 1)
}

/**
 * How well a query word matches a word of a page: 1 for the same stem, 0.7
 * when the page word starts with it (search as you type), 0.5 for one typo
 * in a word of 5 letters or more, else 0.
 */
export function termMatch(term: string, word: string): number {
    if (term === word || stem(term) === stem(word)) return 1
    if (term.length >= 2 && word.startsWith(term)) return 0.7
    if (term.length >= 5 && word.length >= 4 && oneEdit(term, word)) return 0.5
    return 0
}

/** The best match of `term` among `words` (0 when none matches). */
export function bestMatch(term: string, words: string[]): number {
    let best = 0
    for (const w of words) {
        const m = termMatch(term, w)
        if (m > best) best = m
        if (best === 1) break
    }
    return best
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Search rank of a page for a query (0 hides it): title prefix > a word of
 * the title starts with it > title contains it > a keyword or a forgiving
 * title match (stem, typo) > section contains it. Every word that matters
 * (queryTerms) must match.
 */
export function scoreDocMatch(title: string, section: string, query: string, keywords: string[] = []): number {
    const terms = queryTerms(query)
    if (!terms.length) return 1
    const t = title.toLowerCase()
    const s = section.toLowerCase()
    const titleWords = tokenize(title)
    const keywordWords = keywords.flatMap(tokenize)
    let total = 0
    for (const w of terms) {
        if (t.startsWith(w)) total += 1
        else if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}`, 'u').test(t)) total += 0.8
        else if (t.includes(w)) total += 0.6
        else if (bestMatch(w, keywordWords) >= 0.7) total += 0.6
        else if (bestMatch(w, titleWords)) total += 0.5 * bestMatch(w, titleWords)
        else if (s.includes(w)) total += 0.3
        else return 0
    }
    return total / terms.length
}
