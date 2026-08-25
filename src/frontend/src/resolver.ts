import type { RouteManifest, SlotConfig, TemplateConfig } from './types'

export interface TemplateMatch {
    template: string
    layout: string
    slots: Record<string, SlotConfig | null | undefined>
    slotOverrides?: Record<string, SlotConfig | null>
}

export function matchPattern(path: string, pattern: string): boolean {
    const normalizedPath = path.replace(/^\/+|\/+$/g, '')
    const normalizedPattern = pattern.replace(/^\/+|\/+$/g, '')

    const regexPattern = normalizedPattern
        .replace(/\*\*/g, '{{GLOB}}')
        .replace(/\*/g, '[^/]+')
        .replace(/\{\{GLOB\}\}/g, '.*')

    return new RegExp(`^${regexPattern}$`).test(normalizedPath)
}

export function resolveTemplate(
    path: string,
    manifest: RouteManifest,
    templates: Record<string, TemplateConfig>,
): TemplateMatch | null {
    const routes = manifest.routes ?? []
    const sortedRoutes = [...routes].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    for (const route of sortedRoutes) {
        if (!matchPattern(path, route.pattern)) continue

        const template = templates[route.template]
        if (!template) {
            console.warn(`Template "${route.template}" not found`)
            return null
        }

        return {
            template: route.template,
            layout: template.layout ?? 'ThreeColumnLayout',
            slots: template.slots ?? {},
            slotOverrides: route.slotOverrides,
        }
    }

    return null
}

export function mergedSlot(
    slotName: string,
    match: TemplateMatch | null,
): SlotConfig | null | undefined {
    if (!match) return undefined
    if (match.slotOverrides && slotName in match.slotOverrides) {
        return match.slotOverrides[slotName]
    }
    return match.slots[slotName]
}

export function shouldShowToc(match: TemplateMatch | null): boolean {
    const right = mergedSlot('right', match)
    return right !== null
}
