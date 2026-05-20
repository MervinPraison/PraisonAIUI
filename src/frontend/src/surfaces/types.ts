export type SurfaceRenderMode = 'auto' | 'a2ui' | 'components'

export interface A2uiPayload {
    messages: Record<string, unknown>[]
    surface_id?: string
}

export interface SurfaceHostProps {
    mode?: SurfaceRenderMode
    messages?: Record<string, unknown>[]
    components?: import('../components/ComponentRenderer').ComponentDict[]
    surfaceId?: string
    sessionId?: string
    className?: string
}
