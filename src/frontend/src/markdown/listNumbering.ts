/**
 * Chat pre-pass: continue ordered lists that a fenced code block splits.
 *
 * Models very often write numbered steps lazily, every item as `1.`, with a
 * code fence between items:
 *
 *     1. Install            CommonMark (and Streamdown) end the list at the
 *     ```bash               fence, so this renders as three lists that
 *     pip install x         each show "1.". An ordered list's first item
 *     ```                   number becomes its `start`, so numbering the
 *     1. Run                items 1, 2, 3 gives <ol>, <ol start="2">,
 *     ...                   <ol start="3">: the reader sees 1., 2., 3.
 *
 * Rules (line based, run on the source before Streamdown splits it into
 * blocks, so it sees across the fence):
 * - Fenced code (``` or ~~~, any indent) never changes, and does not end a list.
 * - Blank and indented (continuation) lines do not end a list either.
 * - Any other line at the margin (a paragraph, heading, rule, table, quote or
 *   bullet) ends every open list, so the next ordered list starts afresh.
 *   The exception is CommonMark's lazy continuation: plain text directly under
 *   an item's text (no blank line between) still belongs to that item.
 * - A list keeps its first number (`5.` stays 5); later items count up from it.
 *   Nested lists count on their own, by indent.
 * - As in CommonMark, only `1.` can interrupt a paragraph: a hard-wrapped
 *   paragraph line that happens to begin with a number ("released in\n2023.
 *   Since then:") is text, not the start of a list.
 * - Lines are matched without their trailing `\r`, so CRLF text behaves like LF;
 *   the line endings themselves are written back untouched.
 * - Outside a list, an item indented 4+ columns is an indented code block: left alone.
 */

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/
// Blocks that are not paragraphs, so a list of any number may follow directly.
const HEADING_OR_RULE = /^ {0,3}(#{1,6}([ \t]|$)|([-*_])[ \t]*(\3[ \t]*){2,}$|(=+|-+)[ \t]*$)/
// Blocks that can interrupt an item's paragraph, so they are never a lazy continuation.
const BULLET_OR_QUOTE = /^ {0,3}([-+*]([ \t]|$)|>)/
const ITEM = /^([ \t]*)(\d{1,9})([.)])([ \t]|$)/

interface Level {
    indent: number
    next: number
}

const width = (ws: string) => ws.replace(/\t/g, '    ').length

export function continueSplitLists(md: string): string {
    if (!/^[ \t]*\d{1,9}[.)]/m.test(md)) return md
    const lines = md.split('\n')
    let fence: string | null = null
    let levels: Level[] = []
    let changed = false
    // True while the previous line is paragraph text with no list open.
    let paragraph = false
    // True while the previous line is the text of an open list item.
    let itemText = false

    for (let i = 0; i < lines.length; i++) {
        // Match without the CR of a CRLF ending; lines[i] keeps it.
        const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i]
        if (fence) {
            // A closing fence: same character, at least as long, nothing after it.
            const close = line.match(FENCE_CLOSE)
            if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
            continue
        }
        const open = line.match(FENCE_OPEN)
        if (open) {
            fence = open[1]
            paragraph = false
            itemText = false
            continue
        }
        const item = line.match(ITEM)
        if (item) {
            const indent = width(item[1])
            if (levels.length === 0 && indent >= 4) continue // indented code block
            // Paragraph continuation, not a list ("...released in\n2023. Since then:").
            if (levels.length === 0 && paragraph && Number(item[2]) !== 1) continue
            paragraph = false
            itemText = line.slice(item[0].length).trim() !== ''
            while (levels.length && levels[levels.length - 1].indent > indent) levels.pop()
            const top = levels[levels.length - 1]
            let number: number
            if (top && top.indent === indent) {
                number = top.next++
            } else {
                number = Number(item[2])
                levels.push({ indent, next: number + 1 })
            }
            const digits = String(number)
            if (digits !== item[2]) {
                lines[i] = item[1] + digits + lines[i].slice(item[1].length + item[2].length)
                changed = true
            }
            continue
        }
        if (line.trim() === '') {
            paragraph = false
            itemText = false
            continue
        }
        if (/^[ \t]/.test(line)) {
            if (levels.length) itemText = true
            continue
        }
        const block = HEADING_OR_RULE.test(line)
        // Lazy continuation of the item above: the list stays open.
        if (levels.length && itemText && !block && !BULLET_OR_QUOTE.test(line)) continue
        levels = []
        itemText = false
        paragraph = !block
    }
    return changed ? lines.join('\n') : md
}
