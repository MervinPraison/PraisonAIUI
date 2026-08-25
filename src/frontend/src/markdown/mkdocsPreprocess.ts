/** MkDocs Material syntax → standard markdown for react-markdown. */

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

const TAB_HEADING_PREFIX = '\u200Btab:'

export function replaceMkdocsIcons(text: string): string {
    let result = text
    for (const [shortcode, emoji] of Object.entries(MKDOCS_ICON_MAP)) {
        result = result.replaceAll(shortcode, emoji)
    }
    return result
        .replace(/:material-[\w-]+:/g, '•')
        .replace(/:octicons-[\w-]+(?:-\d+)?:/g, '•')
}

export function stripMkdocsGridWrappers(text: string): string {
    return text
        .replace(/<div[^>]*markdown[^>]*>\s*/gi, '')
        .replace(/<\/div>\s*/gi, '')
}

/** Convert `=== "Title"` tab groups to headings the DOM enhancer recognises. */
export function convertMkdocsTabs(md: string): string {
    const lines = md.split('\n')
    const out: string[] = []
    let i = 0

    while (i < lines.length) {
        const tabMatch = lines[i].match(/^===\s+"([^"]+)"\s*$/)
        if (!tabMatch) {
            out.push(lines[i])
            i++
            continue
        }

        const title = tabMatch[1]
        i++
        while (i < lines.length && lines[i].trim() === '') i++

        const block: string[] = []
        while (i < lines.length) {
            if (/^===\s+"[^"]+"\s*$/.test(lines[i])) break
            if (lines[i].trim() === '' && i + 1 < lines.length && /^===\s+"[^"]+"\s*$/.test(lines[i + 1])) break

            if (lines[i].startsWith('    ') || lines[i].trimStart().startsWith('```')) {
                block.push(lines[i].replace(/^    /, ''))
                i++
                continue
            }

            if (block.length > 0 && lines[i].trim() === '') {
                block.push('')
                i++
                continue
            }

            break
        }

        out.push(`### ${TAB_HEADING_PREFIX}${title}`)
        out.push('')
        out.push(...block)
        out.push('')
    }

    return out.join('\n')
}

export function preprocessMkdocsMarkdown(md: string): string {
    let result = stripMkdocsGridWrappers(md)
    result = replaceMkdocsIcons(result)
    result = convertMkdocsTabs(result)
    return result
}

export function isMkdocsTabHeading(text: string): boolean {
    return text.startsWith(TAB_HEADING_PREFIX) || text.startsWith('tab:')
}

export function mkdocsTabTitle(text: string): string {
    return text.replace(/^\u200Btab:/, '').replace(/^tab:/, '')
}
