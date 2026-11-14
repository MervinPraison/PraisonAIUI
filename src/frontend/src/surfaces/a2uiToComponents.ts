import type { ComponentDict } from '../components/ComponentRenderer'

/** Partial A2UI → aiui component mapper (DRY fallback before Google renderer). */

function textFromNode(node: Record<string, unknown>): string {
    const text = node.text
    if (typeof text === 'string') return text
    if (typeof text === 'object' && text !== null) {
        const t = text as Record<string, unknown>
        return String(t.literal ?? t.path ?? '')
    }
    return String(node.content ?? node.label ?? '')
}

/** `![alt](<url>)`, with the characters that would end either part escaped. */
function markdownImage(url: string, alt: string): string {
    const safeAlt = alt.replace(/[\\[\]]/g, (c) => `\\${c}`).replace(/\s+/g, ' ')
    const safeUrl = url.replace(/[<>\s]/g, (c) => encodeURIComponent(c))
    return `![${safeAlt}](<${safeUrl}>)`
}

function mapComponent(comp: Record<string, unknown>): ComponentDict | null {
    const type = comp.component as string | undefined
    if (!type) return null

    switch (type) {
        case 'Text':
            return { type: 'text', content: textFromNode(comp) }
        case 'Markdown':
            return { type: 'markdown', content: textFromNode(comp) }
        case 'Divider':
            return { type: 'separator' }
        case 'Image': {
            const url = String((comp.url as Record<string, unknown>)?.literal ?? comp.url ?? '')
            if (!url) return null
            // As a markdown image: the chat markdown's image gate applies (an
            // agent-chosen off-origin URL is click-to-load, never auto-fetched).
            return { type: 'markdown', content: markdownImage(url, textFromNode(comp)) }
        }
        // Buttons need the A2UI action wiring: leave the surface to A2uiRenderer.
        case 'Button':
            return null
        default:
            return null
    }
}

export function a2uiToComponents(messages: Record<string, unknown>[]): ComponentDict[] | null {
    const out: ComponentDict[] = []
    let sawUnmapped = false

    for (const msg of messages) {
        const update = msg.updateComponents as Record<string, unknown> | undefined
        const components = (update?.components ?? update?.componentList) as Record<string, unknown>[] | undefined
        if (!Array.isArray(components)) continue

        for (const comp of components) {
            const mapped = mapComponent(comp)
            if (mapped) {
                out.push(mapped)
            } else {
                sawUnmapped = true
            }
        }
    }

    if (!out.length) return null
    if (sawUnmapped) return null
    return out
}
