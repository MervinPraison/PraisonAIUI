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
            const url = (comp.url as Record<string, unknown>)?.literal ?? comp.url
            return { type: 'image', src: String(url ?? ''), alt: textFromNode(comp) }
        }
        case 'Button':
            return {
                type: 'button',
                label: textFromNode(comp),
                variant: 'default',
            }
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
