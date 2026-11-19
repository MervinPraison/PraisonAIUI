/**
 * MkDocs Material syntax → markdown plus <aiui-*> blocks that the docs
 * variant of <Markdown> renders as components (MkdocsBlocks.tsx).
 *
 * Every transform here is fence-aware: text inside ``` / ~~~ code blocks is
 * never rewritten. MDX-style component tags (`<Note>`, `<Card>`, …) are
 * expanded by docsTags.ts, the one table of docs components.
 */
import { expandDocsTags } from './docsTags'
import { parseCodeMeta } from '../docs/codeMeta'

export const MKDOCS_ICON_MAP: Record<string, string> = {
    ':material-file-document:': '📄',
    ':material-puzzle:': '🧩',
    ':material-palette:': '🎨',
    ':material-rocket-launch:': '🚀',
    ':material-code-tags:': '💻',
    ':material-cog:': '⚙️',
    ':material-lightning-bolt:': '⚡',
    ':material-shield:': '🛡️',
    ':material-database:': '🗄️',
    ':material-web:': '🌐',
    ':material-book:': '📖',
    ':material-star:': '⭐',
    ':material-check:': '✅',
    ':material-close:': '❌',
    ':material-alert:': '⚠️',
    ':material-information:': 'ℹ️',
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/

/** Split into alternating [prose, fenced code, prose, ...] runs (fences kept verbatim). */
function splitByFences(md: string): { text: string; code: boolean }[] {
    const runs: { text: string; code: boolean }[] = []
    let buf: string[] = []
    let fence: string | null = null
    const flush = (code: boolean) => {
        if (buf.length) runs.push({ text: buf.join('\n'), code })
        buf = []
    }
    for (const line of md.split('\n')) {
        const f = line.match(FENCE_RE)
        if (!fence && f) {
            flush(false)
            fence = f[1]
            buf.push(line)
            continue
        }
        if (fence && f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) {
            buf.push(line)
            fence = null
            flush(true)
            continue
        }
        buf.push(line)
    }
    flush(fence !== null)
    return runs
}

/** Apply `fn` to prose only, leaving fenced code untouched. */
function outsideFences(md: string, fn: (prose: string) => string): string {
    return splitByFences(md)
        .map((r) => (r.code ? r.text : fn(r.text)))
        .join('\n')
}

export function replaceMkdocsIcons(text: string): string {
    return outsideFences(text, (prose) => {
        let result = prose
        for (const [shortcode, emoji] of Object.entries(MKDOCS_ICON_MAP)) {
            result = result.replaceAll(shortcode, emoji)
        }
        return result.replace(/:material-[\w-]+:/g, '•').replace(/:octicons-[\w-]+(?:-\d+)?:/g, '•')
    })
}

/**
 * Drop the `<div class="grid cards" markdown>` wrappers MkDocs Material uses (not their
 * content) and each one's own `</div>`; every other `<div>` keeps its close tag.
 */
export function stripMkdocsGridWrappers(text: string): string {
    const open: boolean[] = [] // per open <div>: is it a wrapper?
    return outsideFences(text, (prose) => prose.replace(/<div\b[^>]*>\s*|<\/div>\s*/gi, (tag) => {
        if (tag[1] === '/') return open.pop() ? '' : tag
        const wrapper = /\bmarkdown\b/i.test(tag)
        if (!/\/>\s*$/.test(tag)) open.push(wrapper)
        return wrapper ? '' : tag
    }))
}

// Attributes are allowed: `<CodeGroup dropdown>` picks the file from a menu instead of tabs.
// <RequestExample> / <ResponseExample> are code groups in the page's side column (docs/panels.ts).
const CODE_GROUP_OPEN = /^\s*<(CodeGroup|RequestExample|ResponseExample)\b([^>]*)>\s*$/i
const CODE_GROUP_CLOSE = /^\s*<\/(?:CodeGroup|RequestExample|ResponseExample)>\s*$/i
const PANEL_KIND: Record<string, string> = { requestexample: 'request', responseexample: 'response' }

/** A fence's tab label in a code group: its title (docs/codeMeta.ts), else its language. */
function fenceLabel(info: string): string {
    const [lang = '', ...rest] = info.trim().split(/\s+/)
    return parseCodeMeta(rest.join(' ')).title ?? (lang || 'Code')
}

/**
 * `<CodeGroup>` … `</CodeGroup>` around fences → one set of tabs, one tab per
 * fence, labelled with its file name or language (the MkDocs tabs renderer).
 * An example (`kind`) is a panel; with one fence, that fence without tabs.
 */
function convertCodeGroup(lines: string[], start: number, dropdown = false, kind?: string): [string[], number] {
    const fences: { label: string; body: string[] }[] = []
    let i = start
    while (i < lines.length && !CODE_GROUP_CLOSE.test(lines[i])) {
        const f = lines[i].match(FENCE_RE)
        if (!f) {
            i++
            continue
        }
        const marker = f[1]
        const label = fenceLabel(lines[i].trim().slice(marker.length))
        const body = [lines[i]]
        i++
        while (i < lines.length) {
            body.push(lines[i])
            const close = lines[i].match(FENCE_RE)
            i++
            if (close && close[1][0] === marker[0] && close[1].length >= marker.length && lines[i - 1].trim() === close[1]) break
        }
        fences.push({ label, body })
    }
    const next = Math.min(i + 1, lines.length)
    const tabs = kind && fences.length === 1
        ? ['', ...fences[0].body, '']
        : [
            '', dropdown ? '<aiui-tabs variant="dropdown">' : '<aiui-tabs>', '',
            ...fences.flatMap((t) => [`<aiui-tab title="${attr(t.label)}">`, '', ...t.body, '', '</aiui-tab>', '']),
            '</aiui-tabs>', '',
        ]
    return [kind ? ['', `<aiui-panel kind="${kind}">`, ...tabs, '</aiui-panel>', ''] : tabs, next]
}

// Titles run to the last quote on the line, as in Python-Markdown, so `\"` inside works.
const ADMONITION_RE = /^(!!!|\?\?\?\+?)\s+([\w-]+)(?:\s+"(.*)")?\s*$/
const TAB_RE = /^===\+?\s+"(.+)"\s*$/
/** Markdown backslash escapes in a title (`\"` → `"`), as Python-Markdown's inline pass does. */
const unescapeTitle = (t: string) => t.replace(/\\([\\`*_{}[\]()#+\-.!"'])/g, '$1')

const isIndented = (line: string) => line.startsWith('    ') || line.startsWith('\t')
const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Collect the 4-space-indented body that follows a `!!!` / `===` marker. */
function collectIndented(lines: string[], start: number): [string[], number] {
    const body: string[] = []
    let i = start
    while (i < lines.length) {
        if (isIndented(lines[i])) {
            body.push(lines[i].startsWith('\t') ? lines[i].slice(1) : lines[i].slice(4))
            i++
            continue
        }
        if (lines[i].trim() === '') {
            let j = i
            while (j < lines.length && lines[j].trim() === '') j++
            if (j < lines.length && isIndented(lines[j])) {
                for (; i < j; i++) body.push('')
                continue
            }
        }
        break
    }
    return [body, i]
}

/**
 * `!!! note "Title"` / `??? tip` / `???+ warning` → <aiui-admonition>, and
 * consecutive `=== "Tab"` groups and `<CodeGroup>` blocks → <aiui-tabs><aiui-tab>. Bodies are
 * converted recursively. Blank lines around the tags keep the inner markdown
 * parsed (CommonMark HTML block type 7). Fenced code is never touched.
 */
export function convertMkdocsBlocks(md: string): string {
    const lines = md.split('\n')
    const out: string[] = []
    let fence: string | null = null
    let i = 0
    while (i < lines.length) {
        const line = lines[i]
        const f = line.match(FENCE_RE)
        if (f) {
            if (!fence) fence = f[1]
            else if (f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null
            out.push(line)
            i++
            continue
        }
        if (fence) {
            out.push(line)
            i++
            continue
        }

        const group = CODE_GROUP_OPEN.exec(line)
        if (group) {
            const dropdown = /(^|\s)dropdown(?![\w=])|dropdown=\{?true/.test(group[2])
            const [tabs, next] = convertCodeGroup(lines, i + 1, dropdown, PANEL_KIND[group[1].toLowerCase()])
            out.push(...tabs)
            i = next
            continue
        }

        const adm = line.match(ADMONITION_RE)
        if (adm) {
            const [, marker, kind, title] = adm
            const [body, next] = collectIndented(lines, i + 1)
            const collapsible = marker.startsWith('???') ? (marker.endsWith('+') ? ' collapsible="open"' : ' collapsible="closed"') : ''
            out.push(
                '',
                `<aiui-admonition type="${attr(kind.toLowerCase())}" title="${attr(unescapeTitle(title ?? ''))}"${collapsible}>`,
                '',
                convertMkdocsBlocks(body.join('\n')),
                '',
                '</aiui-admonition>',
                '',
            )
            i = next
            continue
        }

        if (TAB_RE.test(line)) {
            out.push('', '<aiui-tabs>', '')
            while (i < lines.length) {
                const t = lines[i].match(TAB_RE)
                if (!t) break
                const [body, next] = collectIndented(lines, i + 1)
                out.push(`<aiui-tab title="${attr(unescapeTitle(t[1]))}">`, '', convertMkdocsBlocks(body.join('\n')), '', '</aiui-tab>', '')
                i = next
                while (i < lines.length && lines[i].trim() === '' && i + 1 < lines.length && TAB_RE.test(lines[i + 1])) i++
            }
            out.push('</aiui-tabs>', '')
            continue
        }

        out.push(line)
        i++
    }
    return out.join('\n')
}

/** `custom`: the site's own component tags, tag → module URL (ui-config `site.components`). */
export function preprocessMkdocsMarkdown(md: string, custom?: Readonly<Record<string, string>>): string {
    let result = stripMkdocsGridWrappers(md)
    result = replaceMkdocsIcons(result)
    result = expandDocsTags(result, undefined, custom) // <Note>, <Card>, … (docsTags.ts)
    result = convertMkdocsBlocks(result)
    return result
}
