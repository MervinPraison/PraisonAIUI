// The page's side column: <Panel>, <RequestExample> and <ResponseExample>
// (aiui-panel blocks after preprocessing) move out of the article, in order.
// Content.tsx draws them in a sticky column where "On this page" sits on wide
// screens, and under the article on narrow ones. A panel inside a list item
// (indented) stays where it is. Fenced code is never read as a panel.

const OPEN = /^<aiui-panel\b[^>]*>\s*$/
const CLOSE = /^<\/aiui-panel>\s*$/
const FENCE = /^\s*(`{3,}|~{3,})/

/** Preprocessed Markdown → the article's part and the side column's part ('' when the page has no panel). */
export function splitPanels(md: string): { main: string; side: string } {
    if (!md.includes('<aiui-panel')) return { main: md, side: '' }
    const main: string[] = []
    const side: string[] = []
    let fence: string | null = null
    let depth = 0
    for (const line of md.split('\n')) {
        const f = FENCE.exec(line)
        if (!fence && OPEN.test(line)) depth++
        ;(depth ? side : main).push(line)
        if (fence) {
            if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null
        } else if (f) fence = f[1]
        else if (depth && CLOSE.test(line)) depth--
    }
    return { main: main.join('\n'), side: side.length ? side.join('\n') : '' }
}
