import { useEffect, useMemo, useRef, useState } from 'react'
import { ComponentRenderer } from '../components/ComponentRenderer'
import { a2uiToComponents } from './a2uiToComponents'
import type { SurfaceHostProps } from './types'

interface A2uiRendererProps {
    messages: Record<string, unknown>[]
    surfaceId?: string
    sessionId?: string
    className?: string
}

type IslandModule = {
    mountA2ui?: (
        host: HTMLElement,
        surfaceId: string,
        messages: unknown,
        onAction?: (payload: {
            surfaceId: string
            component_id: string
            action: string
            data: Record<string, unknown>
            timestamp?: string
        }) => void | Promise<void>,
    ) => boolean
    unmountA2ui?: (host: HTMLElement | null) => void
}

let cachedIsland: Promise<IslandModule | null> | null = null

const A2UI_ISLAND_URL = '/plugins/a2ui-island.js'

function loadA2uiIsland(): Promise<IslandModule | null> {
    if (!cachedIsland) {
        cachedIsland = (import(/* @vite-ignore */ A2UI_ISLAND_URL) as Promise<IslandModule>).catch(
            () => null,
        )
    }
    return cachedIsland
}

export function A2uiRenderer({ messages, surfaceId, sessionId, className = '' }: A2uiRendererProps) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)

    const messageKey = useMemo(() => JSON.stringify(messages), [messages])

    useEffect(() => {
        let cancelled = false
        let islandMod: IslandModule | null = null

        async function mount() {
            const host = hostRef.current
            if (!host || !messages?.length) return
            setStatus('loading')
            setError(null)
            const mod = await loadA2uiIsland()
            if (cancelled) return
            islandMod = mod
            if (!mod || typeof mod.mountA2ui !== 'function') {
                setError('A2UI renderer unavailable — rebuild frontend to ship /plugins/a2ui-island.js')
                setStatus('error')
                return
            }
            const sid = surfaceId ?? 'main'
            const mounted = mod.mountA2ui(host, sid, messages, async (payload) => {
                const targetId = payload.surfaceId || sid
                await fetch(`/api/surfaces/${encodeURIComponent(targetId)}/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        version: 'v0.9',
                        component_id: payload.component_id,
                        action: payload.action,
                        data: payload.data,
                        timestamp: payload.timestamp,
                        session_id: sessionId,
                    }),
                })
            })
            if (cancelled) return
            if (mounted) {
                setStatus('ready')
            } else {
                setError('Surface uses a custom catalog or unsupported A2UI payload')
                setStatus('error')
            }
        }

        void mount()
        return () => {
            cancelled = true
            islandMod?.unmountA2ui?.(hostRef.current)
        }
    }, [messageKey, surfaceId, sessionId, messages])

    return (
        <div className={className}>
            <div ref={hostRef} className={status === 'ready' ? 'min-w-0' : 'hidden'} />
            {status === 'loading' && (
                <div className="rounded-md border border-hairline bg-muted/30 p-3 text-xs text-muted-foreground">
                    Loading A2UI surface…
                </div>
            )}
            {status === 'error' && (
                <div className="rounded-md border border-dashed border-hairline p-3 text-xs text-muted-foreground">
                    <p className="mb-1 font-medium text-tier-1">A2UI surface</p>
                    <p>{error}</p>
                    <pre className="mt-2 max-h-40 overflow-auto text-[10px] opacity-70">
                        {JSON.stringify(messages, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    )
}

export function SurfaceHost({
    mode = 'auto',
    messages = [],
    components,
    surfaceId,
    sessionId,
    className = '',
}: SurfaceHostProps) {
    if (components?.length) {
        return (
            <div className={className}>
                <ComponentRenderer components={components} />
            </div>
        )
    }

    if (mode === 'components' || !messages.length) {
        return null
    }

    if (mode === 'auto') {
        const mapped = a2uiToComponents(messages)
        if (mapped?.length) {
            return (
                <div className={className}>
                    <ComponentRenderer components={mapped} />
                </div>
            )
        }
    }

    return (
        <A2uiRenderer
            messages={messages}
            surfaceId={surfaceId}
            sessionId={sessionId}
            className={className}
        />
    )
}
