/**
 * MkDocs Material syntax → markdown plus <aiui-*> blocks that the docs
 * variant of <Markdown> renders as components (MkdocsBlocks.tsx).
 *
 * Every transform here is fence-aware: text inside ``` / ~~~ code blocks is
 * never rewritten.
 */

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

/** Drop the `<div class="grid cards" markdown>` wrappers MkDocs Material uses (not their content). */
export function stripMkdocsGridWrappers(text: string): string {
    return outsideFences(text, (prose) => prose.replace(/<div[^>]*markdown[^>]*>\s*/gi, '').replace(/<\/div>\s*/gi, ''))
}

/**
 * Mintlify-style component tags, each on its own line, map onto blocks the
 * docs renderer already allows: callouts and accordions onto
 * <aiui-admonition>, tabs onto <aiui-tabs>, and steps, cards and frames onto
 * a <div itemtype="aiui:…"> that docs/DocsBlocks.tsx draws (the sanitizer
 * keeps `itemtype`, `title`, `label` and `value` on a div). Attributes:
 * title="…", icon="…", href="…", caption="…", cols={2}, defaultOpen.
 */
const CALLOUTS: Record<string, string> = { note: 'note', info: 'info', tip: 'tip', check: 'check', warning: 'warning', danger: 'danger' }
const TAG_LINE = /^\s*<(\/)?(Note|Info|Tip|Check|Warning|Danger|Accordion|AccordionGroup|Tabs|Tab|Steps|Step|CardGroup|Card|Frame)\b([^>]*?)(\/)?>\s*$/
const TAG_ATTR = /(\w+)(?:=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}))?/g

function tagAttrs(raw: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const m of raw.matchAll(TAG_ATTR)) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? 'true'
    return out
}

/** The opening and closing HTML for one component tag. */
function componentTag(name: string, a: Record<string, string>): [string, string] {
    const t = (v?: string) => (v ? ` title="${attr(v)}"` : '')
    const callout = CALLOUTS[name.toLowerCase()]
    if (callout) return [`<aiui-admonition type="${callout}"${t(a.title)}>`, '</aiui-admonition>']
    switch (name) {
        case 'Accordion':
            return [`<aiui-admonition type="accordion"${t(a.title || 'Details')} collapsible="${a.defaultOpen ? 'open' : 'closed'}">`, '</aiui-admonition>']
        case 'Tabs':
            return ['<aiui-tabs>', '</aiui-tabs>']
        case 'Tab':
            return [`<aiui-tab${t(a.title || 'Tab')}>`, '</aiui-tab>']
        case 'AccordionGroup':
            return ['<div itemtype="aiui:accordions">', '</div>']
        case 'Steps':
            return ['<div itemtype="aiui:steps">', '</div>']
        case 'Step':
            return [`<div itemtype="aiui:step"${t(a.title)}>`, '</div>']
        case 'CardGroup':
            return [`<div itemtype="aiui:cards" value="${attr(a.cols ?? '2')}">`, '</div>']
        case 'Card': {
            const icon = a.icon ? ` label="${attr(a.icon)}"` : ''
            const href = a.href ? ` value="${attr(a.href)}"` : ''
            return [`<div itemtype="aiui:card"${t(a.title)}${icon}${href}>`, '</div>']
        }
        default: // Frame
            return [`<div itemtype="aiui:frame"${t(a.caption)}>`, '</div>']
    }
}

const CODE_GROUP_OPEN = /^\s*<CodeGroup>\s*$/i
const CODE_GROUP_CLOSE = /^\s*<\/CodeGroup>\s*$/i

/** A fence's tab label in a code group: its file name, else its language. */
function fenceLabel(info: string): string {
    const [lang = '', ...rest] = info.trim().split(/\s+/)
    const meta = rest.join(' ')
    const titled = /(?:title|filename)=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(meta)
    if (titled) return titled[1] ?? titled[2] ?? titled[3]
    const bare = rest.find((w) => !/^\{.*\}$/.test(w) && !w.includes('=') && w !== 'noLineNumbers')
    return bare ?? (lang || 'Code')
}

/**
 * `<CodeGroup>` … `</CodeGroup>` around fences → one set of tabs, one tab per
 * fence, labelled with its file name or language (the MkDocs tabs renderer).
 */
function convertCodeGroup(lines: string[], start: number): [string[], number] {
    const tabs: string[] = []
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
        tabs.push(`<aiui-tab title="${attr(label)}">`, '', ...body, '', '</aiui-tab>', '')
    }
    return [['', '<aiui-tabs>', '', ...tabs, '</aiui-tabs>', ''], Math.min(i + 1, lines.length)]
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

        const tag = line.match(TAG_LINE)
        if (tag) {
            const [, closing, name, raw, selfClosing] = tag
            const [open, close] = componentTag(name, tagAttrs(raw))
            if (closing) out.push('', close, '')
            else out.push('', open, '', ...(selfClosing ? [close, ''] : []))
            i++
            continue
        }

        if (CODE_GROUP_OPEN.test(line)) {
            const [group, next] = convertCodeGroup(lines, i + 1)
            out.push(...group)
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

export function preprocessMkdocsMarkdown(md: string): string {
    let result = stripMkdocsGridWrappers(md)
    result = replaceMkdocsIcons(result)
    result = convertMkdocsBlocks(result)
    return result
}
