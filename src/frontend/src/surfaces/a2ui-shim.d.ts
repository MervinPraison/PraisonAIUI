/** Optional A2UI packages — installed via npm when using agent-driven surfaces. */
declare module '@a2ui/web_core/v0_9' {
    export class MessageProcessor {
        constructor(
            catalogs: unknown[],
            actionHandler?: (action: {
                name?: string
                surfaceId?: string
                sourceComponentId?: string
                context?: Record<string, unknown>
                timestamp?: string
            }) => void,
        )
        processMessages(messages: unknown[]): void
        readonly model: {
            getSurface(id: string): {
                componentsModel: { entries: Iterable<[string, { type?: string }]> }
                dataModel: { get(path: string): unknown }
            } | undefined
            readonly surfacesMap: Map<string, unknown>
        }
        getSurfaces?(): unknown[]
        surfaces?: unknown[]
    }
}

declare module '@a2ui/react/v0_9' {
    import type { ComponentType } from 'react'
    export const basicCatalog: unknown
    export const A2uiSurface: ComponentType<{
        surface: unknown
        processor: unknown
        onAction?: (action: Record<string, unknown>) => void
    }>
}
