import { useCallback, useEffect, useState } from 'react'
import type { DashboardPageProps } from '../types/dashboard'
import { SurfaceHost } from '../surfaces/SurfaceHost'

/**
 * Full-page A2UI canvas — live surface backed by /api/surfaces/{id}.
 */
export function CanvasView({ page }: DashboardPageProps) {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
    const surfaceId = params.get('surface') ?? (page as { surface_id?: string }).surface_id ?? 'main'
    const [messages, setMessages] = useState<Record<string, unknown>[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const loadSurface = useCallback(async () => {
        try {
            setLoading(true)
            const res = await fetch(`/api/surfaces/${encodeURIComponent(surfaceId)}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setMessages((data.messages ?? []) as Record<string, unknown>[])
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load surface')
        } finally {
            setLoading(false)
        }
    }, [surfaceId])

    useEffect(() => {
        loadSurface()
    }, [loadSurface])

    useEffect(() => {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const ws = new WebSocket(`${proto}://${window.location.host}/api/chat/ws`)
        ws.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data)
                if (data.type === 'a2ui_surface' && data.surface_id === surfaceId && data.messages) {
                    setMessages(data.messages as Record<string, unknown>[])
                }
            } catch {
                /* ignore */
            }
        }
        return () => ws.close()
    }, [surfaceId])

    if (loading) {
        return <div className="p-6 text-muted-foreground">Loading canvas…</div>
    }

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">{page.title}</h2>
                <button
                    type="button"
                    onClick={loadSurface}
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                >
                    ↻ Refresh
                </button>
            </div>
            {error ? (
                <div className="text-destructive text-sm mb-4">{error}</div>
            ) : null}
            <SurfaceHost mode="auto" messages={messages} surfaceId={surfaceId} />
        </div>
    )
}
