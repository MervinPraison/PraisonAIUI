// Fence meta for docs code blocks: what follows the language on a fence line.
//
//   ```python title="app.py" {1,3-4}
//   ```python app.py {2}                  (a bare first word is the file name)
//   ```python hl_lines="2 3"             (MkDocs) or highlight="2-3"
//
// Streamdown keeps it on the code element (`metastring`); docs/DocsPre.tsx
// reads it. Key=value words it does not know (startLine=5) are left alone.

export interface CodeMeta {
    /** File name or caption shown in the block's header. */
    title?: string
    /** 1-based line numbers to highlight, ascending, no duplicates. */
    lines: number[]
}

/** Lines past this are ignored (a typo like {1-99999} must not build a huge list). */
const MAX_LINE = 2000

/** "1,3-4" or "1 3-4" → [1, 3, 4]. */
export function parseLineSpec(spec: string): number[] {
    const out = new Set<number>()
    for (const part of spec.split(/[\s,]+/).filter(Boolean)) {
        const m = /^(\d+)(?:-(\d+))?$/.exec(part)
        if (!m) continue
        const from = Number(m[1])
        const to = Math.min(m[2] ? Number(m[2]) : from, MAX_LINE)
        for (let n = Math.max(1, from); n <= to; n++) out.add(n)
    }
    return [...out].sort((a, b) => a - b)
}

const TOKEN = /(\w+)=("([^"]*)"|'([^']*)'|\S+)|\{([^}]*)\}|"([^"]*)"|(\S+)/g

export function parseCodeMeta(meta?: string | null): CodeMeta {
    const result: CodeMeta = { lines: [] }
    if (!meta) return result
    let bare: string | undefined
    for (const m of meta.matchAll(TOKEN)) {
        const [, key, raw, dq, sq, braces, quoted, word] = m
        if (key) {
            const value = dq ?? sq ?? raw
            if (key === 'title' || key === 'filename') result.title = value
            else if (key === 'highlight' || key === 'hl_lines' || key === 'lines') result.lines = parseLineSpec(value)
        } else if (braces !== undefined) {
            result.lines = parseLineSpec(braces)
        } else if (bare === undefined) {
            bare = quoted ?? word
        }
    }
    // A bare word is the file name (Mintlify style), unless it is a
    // Streamdown flag such as noLineNumbers.
    if (!result.title && bare && !/^noLineNumbers$/.test(bare)) result.title = bare
    return result
}
