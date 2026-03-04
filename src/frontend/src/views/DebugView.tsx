import { useEffect, useState } from 'react'
import type { DashboardPageProps } from '../types/dashboard'

interface DebugData {
    python: string
    platform: string
    packages: Record<string, string>
    callbacks_registered: string[]
    agents_registered: string[]
    datastore_type: string
    config_path: string | null
    log_buffer_size: number
}

export function DebugView(_props: DashboardPageProps) {
    const [data, setData] = useState<DebugData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchDebug = async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/debug')
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setData(await res.json())
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchDebug() }, [])

    if (loading) return <div className="p-6 text-muted-foreground">Loading debug info...</div>
    if (error) return <div className="p-6 text-destructive">Error: {error}</div>
    if (!data) return null

    const sections = [
        {
            title: 'System',
            items: [
                { label: 'Python', value: data.python.split('|')[0].trim() },
                { label: 'Platform', value: data.platform },
                { label: 'Datastore', value: data.datastore_type },
                { label: 'Config Path', value: data.config_path || 'None' },
                { label: 'Log Buffer', value: `${data.log_buffer_size} entries` },
            ],
        },
        {
            title: 'Packages',
            items: Object.entries(data.packages).map(([name, version]) => ({
                label: name,
                value: version,
            })),
        },
        {
            title: 'Callbacks',
            items: data.callbacks_registered.map((cb) => ({
                label: cb,
                value: '✅ registered',
            })),
        },
        {
            title: 'Agents',
            items: data.agents_registered.map((a) => ({
                label: a,
                value: '🤖 active',
            })),
        },
    ]

    return (
        <div className="p-6 space-y-4 max-w-5xl">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Debug Information</h2>
                <button
                    onClick={fetchDebug}
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                >
                    ↻ Refresh
                </button>
            </div>

            {sections.map((section) => (
                <div key={section.title} className="rounded-lg border bg-card">
                    <div className="px-4 py-3 border-b">
                        <h3 className="font-semibold">{section.title}</h3>
                    </div>
                    <div className="divide-y">
                        {section.items.map((item) => (
                            <div key={item.label} className="px-4 py-2.5 flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">{item.label}</span>
                                <span className="font-mono text-xs">{item.value}</span>
                            </div>
                        ))}
                        {section.items.length === 0 && (
                            <div className="px-4 py-3 text-sm text-muted-foreground">None</div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    )
}
