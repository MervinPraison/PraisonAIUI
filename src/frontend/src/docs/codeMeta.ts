// Fence meta for docs code blocks: what follows the language on a fence line.
//
//   ```python title="app.py" {1,3-4}
//   ```python Example title lines wrap  (bare words up to the first option are the title)
//   ```ts highlight={1-2,5} focus={3} icon="code" expandable nocopy
//   ```python hl_lines="2 3"            (MkDocs)
//
// and, in the code itself, Shiki's notation comments: `// [!code ++]`,
// `# [!code --:2]`, `[!code highlight]`, `[!code focus]` (parseCodeNotation).
// Streamdown keeps the meta on the code element (`metastring`); docs/DocsPre.tsx
// reads both. Key=value words it does not know (startLine=5) are left alone.

export interface CodeMeta {
    /** File name or caption shown in the block's header. */
    title?: string
    /** Icon name shown before the title. */
    icon?: string
    /** 1-based line numbers to highlight, ascending, no duplicates. */
    highlight: number[]
    /** 1-based lines kept sharp; the others dim until the block is hovered. */
    focus: number[]
    /** `lines`: a line-number gutter. */
    lineNumbers?: boolean
    /** `wrap`: long lines wrap instead of scrolling sideways. */
    wrap?: boolean
    /** `expandable`: a long block shows its first lines and a "Show all" toggle. */
    expandable?: boolean
    /** `nocopy`: no copy button. */
    nocopy?: boolean
}

/** Lines past this are ignored (a typo like {1-99999} must not build a huge list). */
const MAX_LINE = 2000

/** "1,3-4", "1 3-4", "{1-2,5}" or "[1,3]" → [1, 3, 4]. */
export function parseLineSpec(spec: string): number[] {
    const out = new Set<number>()
    for (const part of spec.replace(/[{}[\]"']/g, ' ').split(/[\s,]+/).filter(Boolean)) {
        const m = /^(\d+)(?:-(\d+))?$/.exec(part)
        if (!m) continue
        const from = Number(m[1])
        const to = Math.min(m[2] ? Number(m[2]) : from, MAX_LINE)
        for (let n = Math.max(1, from); n <= to; n++) out.add(n)
    }
    return [...out].sort((a, b) => a - b)
}

/** Boolean options: a bare word turns one on, `name="false"` (or `{false}`) off. */
const FLAGS: Record<string, 'lineNumbers' | 'wrap' | 'expandable' | 'nocopy' | null> = {
    lines: 'lineNumbers',
    wrap: 'wrap',
    expandable: 'expandable',
    nocopy: 'nocopy',
    twoslash: null, // accepted so it is never a title; type hovers are not drawn
    noLineNumbers: null, // Streamdown's own flag
}

const TOKEN = /(\w+)=("([^"]*)"|'([^']*)'|\{[^}]*\}|\[[^\]]*\]|\S+)|\{([^}]*)\}|"([^"]*)"|(\S+)/g

export function parseCodeMeta(meta?: string | null): CodeMeta {
    const result: CodeMeta = { highlight: [], focus: [] }
    if (!meta) return result
    const title: string[] = []
    let options = false // the title ends at the first option
    for (const m of meta.matchAll(TOKEN)) {
        const [, key, raw, dq, sq, braces, quoted, word] = m
        if (key) {
            options = true
            const value = (dq ?? sq ?? raw).replace(/^\{(.*)\}$/, '$1')
            if (key === 'title' || key === 'filename') result.title = value
            else if (key === 'icon') result.icon = value
            else if (key === 'highlight' || key === 'hl_lines') result.highlight = parseLineSpec(value)
            else if (key === 'focus') result.focus = parseLineSpec(value)
            else if (FLAGS[key]) result[FLAGS[key]] = value !== 'false'
        } else if (braces !== undefined) {
            options = true
            result.highlight = parseLineSpec(braces)
        } else if (word !== undefined && word in FLAGS) {
            options = true
            const flag = FLAGS[word]
            if (flag) result[flag] = true
        } else if (!options) {
            title.push(quoted ?? word)
        }
    }
    if (!result.title && title.length) result.title = title.join(' ')
    return result
}

export interface CodeNotation {
    /** The code without its notation comments. */
    code: string
    add: number[]
    remove: number[]
    highlight: number[]
    focus: number[]
}

// `[!code ++]` at the end of a line, in whatever comment the language uses.
const NOTATION = /\s*(?:\/\/|#|--|;|%|<!--|\{?\/\*)?\s*\[!code\s+(\+\+|--|highlight|hl|focus)(?::(\d+))?\]\s*(?:-->|\*\/\}?)?\s*$/
const KIND = { '++': 'add', '--': 'remove', highlight: 'highlight', hl: 'highlight', focus: 'focus' } as const

/**
 * Shiki's notation comments (`// [!code ++]`, `--`, `highlight`, `focus`). `[!code ++:3]` marks its
 * line and the next two. A comment alone on its line is removed and marks the
 * lines after it. Null when the code has none (the common case).
 */
export function parseCodeNotation(code: string): CodeNotation | null {
    if (!code.includes('[!code')) return null
    const marks: Omit<CodeNotation, 'code'> = { add: [], remove: [], highlight: [], focus: [] }
    const out: string[] = []
    let found = false
    for (const line of code.split('\n')) {
        const m = NOTATION.exec(line)
        if (!m) {
            out.push(line)
            continue
        }
        found = true
        const rest = line.slice(0, m.index)
        const first = out.length + 1
        const count = Math.min(Number(m[2] ?? 1) || 1, MAX_LINE)
        for (let n = first; n < first + count; n++) marks[KIND[m[1] as keyof typeof KIND]].push(n)
        if (rest.trim()) out.push(rest)
    }
    return found ? { code: out.join('\n'), ...marks } : null
}

/**
 * `<CodeBlock language="js" filename="a.js" lines highlight="[1,3]">` → the
 * same fence a page would write, so both forms render through DocsPre.
 */
export function codeBlockFence(attrs: Record<string, string>, body: string, indent = ''): string[] {
    const on = (v?: string) => v !== undefined && v !== 'false'
    const lang = /^[\w#+.-]{1,32}$/.test(attrs.language ?? attrs.lang ?? '') ? (attrs.language ?? attrs.lang) : 'text'
    const quote = (v: string) => (v.includes('"') ? `'${v.replace(/'/g, '')}'` : `"${v}"`)
    const meta: string[] = []
    const title = attrs.filename ?? attrs.title
    if (title) meta.push(`title=${quote(title)}`)
    if (attrs.icon) meta.push(`icon=${quote(attrs.icon)}`)
    for (const flag of ['lines', 'wrap', 'expandable', 'nocopy']) if (on(attrs[flag])) meta.push(flag)
    for (const key of ['highlight', 'focus']) {
        const lines = parseLineSpec(attrs[key] ?? '')
        if (lines.length) meta.push(`${key}={${lines.join(',')}}`)
    }
    // The body: a {`…`} template literal or plain lines, dedented.
    let text = body.replace(/^\s*\n|\n\s*$/g, '')
    const literal = /^\s*\{\s*`([\s\S]*)`\s*\}\s*$/.exec(text)
    if (literal) text = literal[1].replace(/\\`/g, '`').replace(/^\n|\n$/g, '')
    const lines = text.split('\n')
    const strip = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length), Infinity)
    const code = lines.map((l) => l.slice(Number.isFinite(strip) ? strip : 0))
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
    const fence = '`'.repeat(Math.max(3, longest + 1))
    return [`${fence}${lang}${meta.length ? ' ' + meta.join(' ') : ''}`, ...code, fence].map((l) => (l ? indent + l : l))
}
