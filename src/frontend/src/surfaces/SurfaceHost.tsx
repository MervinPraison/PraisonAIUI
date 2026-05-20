import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { ComponentRenderer } from '../components/ComponentRenderer'
import { a2uiToComponents } from './a2uiToComponents'
import type { SurfaceHostProps } from './types'

interface A2uiRendererProps {
    messages: Record<string, unknown>[]
    surfaceId?: string
    sessionId?: string
    className?: string
}

type SurfaceEntry = {
    id: string
    surface: unknown
    processor: unknown
    A2uiSurface: ComponentType<{
        surface: unknown
        processor: unknown
        onAction?: (action: Record<string, unknown>) => void
    }>
}

export function A2uiRenderer({ messages, surfaceId, sessionId, className = '' }: A2uiRendererProps) {
    const [surfaces, setSurfaces] = useState<SurfaceEntry[]>([])
    const [error, setError] = useState<string | null>(null)
    const [ready, setReady] = useState(false)

    const messageKey = useMemo(() => JSON.stringify(messages), [messages])

    useEffect(() => {
        let cancelled = false

        async function load() {
            setError(null)
            try {
                const webCore = await import(/* @vite-ignore */ '@a2ui/web_core/v0_9')
                const reactMod = await import(/* @vite-ignore */ '@a2ui/react/v0_9')
                const { MessageProcessor } = webCore
                const { A2uiSurface, basicCatalog } = reactMod

                const processor = new MessageProcessor([basicCatalog])
                processor.processMessages(messages)

                const rawSurfaces = (processor as { getSurfaces?: () => unknown[] }).getSurfaces?.()
                    ?? (processor as { surfaces?: unknown[] }).surfaces
                    ?? []

                const list: SurfaceEntry[] = []
                if (Array.isArray(rawSurfaces) && rawSurfaces.length) {
                    for (const s of rawSurfaces) {
                        const id = typeof s === 'string' ? s : (s as { id?: string })?.id ?? 'main'
                        list.push({ id, surface: s, A2uiSurface, processor })
                    }
                } else {
                    list.push({
                        id: surfaceId ?? 'main',
                        surface: surfaceId ?? 'main',
                        A2uiSurface,
                        processor,
                    })
                }

                if (!cancelled) {
                    setSurfaces(list)
                    setReady(true)
                }
            } catch (e) {
                if (!cancelled) {
                    setError(
                        e instanceof Error
                            ? e.message
                            : 'A2UI renderer unavailable — install @a2ui/react and @a2ui/web_core',
                    )
                    setReady(false)
                }
            }
        }

        if (messages?.length) {
            load()
        }
        return () => {
            cancelled = true
        }
    }, [messageKey, surfaceId, messages])

    if (error) {
        return (
            <div className={`rounded-md border border-dashed p-3 text-xs text-muted-foreground ${className}`}>
                <p className="font-medium mb-1">A2UI surface</p>
                <p>{error}</p>
                <pre className="mt-2 max-h-40 overflow-auto text-[10px] opacity-70">
                    {JSON.stringify(messages, null, 2)}
                </pre>
            </div>
        )
    }

    if (!ready || !surfaces.length) {
        return (
            <div className={`rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground ${className}`}>
                Loading A2UI surface…
            </div>
        )
    }

    return (
        <div className={`space-y-2 ${className}`}>
            {surfaces.map((entry) => (
                <entry.A2uiSurface
                    key={entry.id}
                    surface={entry.surface}
                    processor={entry.processor}
                    onAction={async (action) => {
                        const sid = surfaceId ?? entry.id
                        await fetch(`/api/surfaces/${sid}/action`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...action, session_id: sessionId }),
                        })
                    }}
                />
            ))}
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
