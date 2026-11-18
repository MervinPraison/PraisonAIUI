/**
 * Docs component tags (`<Note>`, `<Card>`, ...): ONE table drives the
 * tokenizer below, the sanitizer allowlist the docs page hands to <Markdown>
 * and (mirrored in compiler/docs_tags.py) the build warning for unknown tags.
 * Adding a component (docs/features/how-to-add-a-feature.md): an entry here,
 * its renderer in DOCS_TAG_COMPONENTS (docs/DocsBlocks.tsx), its name in KNOWN_DOCS_TAGS.
 * Tags may share a line with their text, nest in list items, self-close and
 * spread attributes over lines. An unknown PascalCase tag is dropped and its
 * children render as Markdown. `{/* … *\/}` comments go. Code is untouched.
 */

import { codeBlockFence } from '../docs/codeMeta'

export type TagAttrs = Record<string, string>

export interface DocsTag {
    /** The element the tag becomes; always `aiui-*` (Markdown only allows those from a page). */
    el: string
    /** Attributes kept on the element, lower case; the sanitizer drops any other. */
    attrs?: readonly string[]
    /** The element's attributes from the author's (default: copy those named in `attrs`). */
    map?: (a: TagAttrs) => Record<string, string | undefined>
    /** Sits inside a sentence (Badge, Tooltip); otherwise a block. */
    inline?: boolean
}

const on = (v?: string) => v !== undefined && v !== 'false'
const callout = (type: string): DocsTag => ({ el: 'aiui-admonition', attrs: ['type', 'title'], map: (a) => ({ type, title: a.title }) })
/** `id="…"` for deep links (`#id` opens a tab or accordion): word characters and dashes only. */
const anchor = (a: TagAttrs) => (/^[\w-]+$/.test(a.id ?? '') ? a.id : undefined)
const ICON = ['icon', 'anchor'] as const
/** `pre={["a", "b"]}` or `pre="a, b"` → `a,b`: the labels shown before or after a field's name. */
const labels = (v?: string) => v?.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean).join(',')
/** <ParamField path|query|body|header="name"> and <ResponseField name>: one field row (docs/ApiFields.tsx). */
const FIELD_IN = ['path', 'query', 'body', 'header'] as const
const apiField = (response: boolean): DocsTag => ({
    el: 'aiui-field',
    attrs: ['field', 'at', 'type', 'req', 'dep', 'dflt', 'hint', 'pre', 'post', 'anchor'],
    map: (a) => {
        const at = response ? 'response' : FIELD_IN.find((k) => a[k] !== undefined)
        return {
            field: at && at !== 'response' ? a[at] : a.name, at: at ?? 'param', type: a.type,
            req: on(a.required) ? 'true' : undefined, dep: on(a.deprecated) ? 'true' : undefined,
            dflt: a.default, hint: a.placeholder, pre: labels(a.pre), post: labels(a.post), anchor: anchor(a),
        }
    },
})

export const DOCS_TAGS: Record<string, DocsTag> = {
    Note: callout('note'),
    Info: callout('info'),
    Tip: callout('tip'),
    Check: callout('check'),
    Warning: callout('warning'),
    Danger: callout('danger'),
    Accordion: {
        el: 'aiui-admonition',
        attrs: ['type', 'title', 'collapsible', 'description', ...ICON],
        map: (a) => ({
            type: 'accordion', title: a.title || 'Details', collapsible: on(a.defaultOpen) ? 'open' : 'closed',
            description: a.description, icon: a.icon, anchor: anchor(a),
        }),
    },
    AccordionGroup: { el: 'aiui-accordions' },
    // Tabs sync by title across the page (and are remembered) unless sync={false}.
    Tabs: {
        el: 'aiui-tabs',
        attrs: ['sync', 'initial', 'rule', 'variant'],
        map: (a) => ({ sync: a.sync === 'false' ? 'off' : undefined, initial: a.defaultTabIndex, rule: on(a.borderBottom) ? 'bottom' : undefined }),
    },
    Tab: { el: 'aiui-tab', attrs: ['title', ...ICON], map: (a) => ({ title: a.title || 'Tab', icon: a.icon, anchor: anchor(a) }) },
    Steps: { el: 'aiui-steps', attrs: ['heading'], map: (a) => ({ heading: a.titleSize }) },
    Step: {
        el: 'aiui-step',
        attrs: ['title', 'heading', 'num', ...ICON],
        map: (a) => ({ title: a.title, heading: a.titleSize, num: a.stepNumber, icon: a.icon, anchor: anchor(a) }),
    },
    CardGroup: { el: 'aiui-cards', attrs: ['cols'] },
    Columns: { el: 'aiui-cards', attrs: ['cols'] },
    Column: { el: 'aiui-column' },
    Card: { el: 'aiui-card', attrs: ['title', 'icon', 'href', 'horizontal', 'img', 'cta', 'arrow', 'color'] },
    Frame: { el: 'aiui-frame', attrs: ['caption'] },
    ParamField: apiField(false),
    ResponseField: apiField(true),
    Expandable: { el: 'aiui-expandable', attrs: ['title', 'opened'], map: (a) => ({ title: a.title, opened: on(a.defaultOpen) ? 'true' : undefined }) },
    // The page's side column (docs/panels.ts); `kind` is set by <RequestExample> / <ResponseExample>.
    Panel: { el: 'aiui-panel', attrs: ['kind'], map: () => ({}) },
}

/** Tags converted elsewhere (code groups and examples: convertMkdocsBlocks; CodeBlock: into a fence, below). */
const PASSTHROUGH = new Set(['CodeGroup', 'CodeBlock', 'RequestExample', 'ResponseExample'])

/** Every tag name a page may use (the Python build checks pages against the same list). */
export const DOCS_TAG_NAMES: readonly string[] = [...Object.keys(DOCS_TAGS), ...PASSTHROUGH]

/** Element → attributes for the docs sanitizer (Markdown `allowElements`). */
export const DOCS_ALLOWED_ELEMENTS: Readonly<Record<string, readonly string[]>> = {}
for (const t of Object.values(DOCS_TAGS)) (DOCS_ALLOWED_ELEMENTS as Record<string, string[]>)[t.el] = [...(DOCS_ALLOWED_ELEMENTS[t.el] ?? []), ...(t.attrs ?? [])]

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** `<el a="…">` with only the attributes the table names for it. */
function openTag(spec: DocsTag, a: TagAttrs): string {
    const values: Record<string, string | undefined> = spec.map ? spec.map(a) : a
    const parts = (spec.attrs ?? []).flatMap((k) => (values[k] ? [` ${k}="${escapeAttr(values[k]!)}"`] : []))
    return `<${spec.el}${parts.join('')}>`
}

const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/
const LIST_MARKER = new RegExp(LIST_ITEM.source + '$')
// A component name has a lower-case letter, so `<DIV>` and `<B>` stay HTML.
const HEAD = /<(\/?)([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*)/y
const ATTR = /\s*([A-Za-z_$][\w:.$-]*)(?:=("[^"]*"|'[^']*'|\{|[^\s>"'{]+))?/y

/** The index after the `{…}` at `p` (quotes and nesting respected), or -1 when the text ends first. */
function skipBraces(s: string, p: number): number {
    for (let i = p, depth = 0; i < s.length; i++) {
        if (`"'\``.includes(s[i])) {
            i = s.indexOf(s[i], i + 1)
            if (i < 0) return -1
        } else if (s[i] === '{') depth++
        else if (s[i] === '}' && --depth === 0) return i + 1
    }
    return -1
}

type ParsedTag = { closing: boolean; name: string; attrs: TagAttrs; selfClosing: boolean; end: number }

/** A JSX-style tag at `s[p]`: null when it is not one, 'more' when the text ends inside it. */
function parseTag(s: string, p: number): ParsedTag | null | 'more' {
    HEAD.lastIndex = p
    const m = HEAD.exec(s)
    if (!m || !/[a-z]/.test(m[2])) return null
    const [closing, name, attrs] = [m[1] === '/', m[2], {} as TagAttrs]
    for (let i = HEAD.lastIndex; ; ) {
        while (/\s/.test(s[i] ?? '')) i++
        if (i >= s.length) return 'more'
        const selfClosing = s.startsWith('/>', i)
        if (selfClosing || s[i] === '>') return { closing, name, attrs, selfClosing, end: i + (selfClosing ? 2 : 1) }
        if (closing) return null
        if (s[i] === '{') { // {...spread}
            i = skipBraces(s, i)
            if (i < 0) return 'more'
            continue
        }
        ATTR.lastIndex = i
        const a = ATTR.exec(s)
        if (!a) return /^=?["']/.test(s.slice(i).replace(/^[\w$:.-]+/, '')) ? 'more' : null // an unclosed quote
        i = ATTR.lastIndex
        if (a[2] === '{') {
            const end = skipBraces(s, i - 1)
            if (end < 0) return 'more'
            const expr = s.slice(i, end - 1).trim() // {3} → 3, {"a"} → a, else as written
            attrs[a[1]] = /^(["'`])([\s\S]*)\1$/.exec(expr)?.[2] ?? expr
            i = end
        } else attrs[a[1]] = a[2] ? a[2].replace(/^(["'])([\s\S]*)\1$/, '$2') : 'true'
    }
}

const FENCE = /^\s*(`{3,}|~{3,})/
const leading = (s: string) => /^[ \t]*/.exec(s)![0].length
/** Remove up to `n` columns of leading spaces. */
const dedent = (s: string, n: number) => s.slice(Math.min(n, leading(s)))

type Open = { name: string; spec?: DocsTag; indent: string; strip: number | null }

const CODE_BLOCK = /^(\s*)<CodeBlock\b/
const CODE_BLOCK_END = '</CodeBlock>'

/**
 * `<CodeBlock language="js" filename="a.js" lines>code</CodeBlock>` starting at
 * `lines[li]` → the equivalent fence and the index of its last line, or null.
 */
function codeBlockAt(lines: string[], li: number, first: string): [string[], number] | null {
    const indent = CODE_BLOCK.exec(first)![1]
    let [joined, next] = [first, li]
    let tag = parseTag(joined, indent.length)
    while (tag === 'more' && next - li < 50 && next + 1 < lines.length) {
        joined += ' ' + lines[++next].trim()
        tag = parseTag(joined, indent.length)
    }
    if (!tag || tag === 'more') return null
    if (tag.selfClosing) return [[], next]
    const body: string[] = []
    let rest = joined.slice(tag.end)
    for (;;) {
        const end = rest.indexOf(CODE_BLOCK_END)
        if (end >= 0) {
            body.push(rest.slice(0, end))
            break
        }
        body.push(rest)
        if (++next >= lines.length) return null
        rest = lines[next]
    }
    return [codeBlockFence(tag.attrs, body.join('\n'), indent), next]
}

/** Rewrites docs component tags into the `aiui-*` elements the docs renderer draws. */
export function expandDocsTags(md: string, tags: Record<string, DocsTag> = DOCS_TAGS): string {
    const lines = md.split('\n')
    const out: string[] = []
    const stack: Open[] = []
    let fence: string | null = null
    let cur = ''
    let skipSpace = false

    // A block element on lines of its own, blank lines around it, at `indent`.
    const emitBlock = (html: string, indent: string) => {
        if (LIST_MARKER.test(cur)) out.push(cur + html)
        else {
            if (cur.trim()) out.push(cur.trimEnd())
            if (out.length && out[out.length - 1].trim()) out.push('')
            out.push(indent + html)
        }
        out.push('')
        cur = indent
        skipSpace = true
    }
    const stripFor = () => stack.reduce((n, o) => n + (o.strip ?? 0), 0)

    for (let li = 0; li < lines.length; li++) {
        let raw = lines[li]
        // The first child line of a component sets how far its children are
        // dedented: MDX has no indented code, so `<Step>` bodies may be indented.
        const top = stack[stack.length - 1]
        if (top && top.strip === null && raw.trim()) {
            top.strip = Math.max(0, leading(raw) - stripFor() - top.indent.length)
        }
        raw = dedent(raw, stripFor())

        const f = raw.match(FENCE)
        const codeBlock = !fence && CODE_BLOCK.test(raw) && (stack.length > 0 || leading(raw) < 4) ? codeBlockAt(lines, li, raw) : null
        if (codeBlock) {
            if (out.length && out[out.length - 1].trim()) out.push('')
            out.push(...codeBlock[0], '')
            li = codeBlock[1]
            continue
        }
        if (fence || f) {
            if (!fence) fence = f![1]
            else if (f && f[1][0] === fence[0] && f[1].length >= fence.length && raw.trim() === f[1]) fence = null
            out.push(raw)
            continue
        }

        let s = raw
        cur = ''
        skipSpace = false
        // Indented 4+ outside any component: maybe an indented code block, so
        // unknown tags (`List<String>`) and `{/* */}` stay as written.
        const codeLike = !stack.length && leading(raw) >= 4
        // A list item's content column, else the line's own indent.
        const lineIndent = () => ' '.repeat((LIST_ITEM.exec(cur) ?? /^\s*/.exec(cur)!)[0].length)
        let i = 0
        while (i < s.length) {
            const c = s[i]
            if (skipSpace && (c === ' ' || c === '\t') && ++i) continue
            skipSpace = false
            if (c === '\\' && i + 1 < s.length) {
                cur += s.slice(i, i + 2)
                i += 2
                continue
            }
            if (c === '`') { // a code span, verbatim
                const ticks = /^`+/.exec(s.slice(i))![0]
                const close = s.indexOf(ticks, i + ticks.length)
                const end = (close < 0 ? i : close) + ticks.length
                cur += s.slice(i, end)
                i = end
                continue
            }
            if (!codeLike && s.startsWith('{/*', i)) {
                let [end, rest, next] = [s.indexOf('*/}', i), s, li]
                while (end < 0 && next + 1 < lines.length) end = (rest = lines[++next]).indexOf('*/}')
                if (end >= 0) {
                    s = s.slice(0, i) + rest.slice(end + 3)
                    li = next
                    continue
                }
            }
            if (c === '<') {
                let tag = parseTag(s, i)
                // Attributes over several lines: read on (one tag, joined with spaces).
                let joined = s
                let next = li
                while (tag === 'more' && next - li < 50 && next + 1 < lines.length) {
                    joined += ' ' + lines[++next].trim()
                    tag = parseTag(joined, i)
                }
                if (tag && tag !== 'more') {
                    ;[s, li] = [joined, next]
                    const start = i
                    i = tag.end
                    const spec = tags[tag.name]
                    if (PASSTHROUGH.has(tag.name) || (!spec && codeLike)) {
                        cur += s.slice(start, i)
                        continue
                    }
                    if (spec?.inline) {
                        cur += tag.closing ? `</${spec.el}>` : openTag(spec, tag.attrs) + (tag.selfClosing ? `</${spec.el}>` : '')
                        continue
                    }
                    if (tag.closing) {
                        const at = stack.map((o) => o.name).lastIndexOf(tag.name)
                        if (at < 0) continue // stray close tag
                        const [open] = stack.splice(at)
                        if (open.spec) emitBlock(`</${open.spec.el}>`, open.indent)
                        continue
                    }
                    const indent = lineIndent()
                    if (spec) {
                        emitBlock(openTag(spec, tag.attrs), indent)
                        if (tag.selfClosing) emitBlock(`</${spec.el}>`, indent)
                        else stack.push({ name: tag.name, spec, indent, strip: s.slice(i).trim() ? 0 : null })
                    } else if (!tag.selfClosing && !cur.trim() && !s.slice(i).trim()) {
                        // Unknown, alone on its line: drop it and dedent its children like a block's.
                        stack.push({ name: tag.name, indent, strip: null })
                    }
                    continue
                }
            }
            cur += c
            i++
        }
        if (cur.trim() || !(out.length && out[out.length - 1] === '')) out.push(cur.trim() ? cur : '')
    }
    return out.join('\n')
}
