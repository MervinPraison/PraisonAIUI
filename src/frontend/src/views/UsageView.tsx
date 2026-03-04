import { useEffect, useState } from 'react'
import type { DashboardPageProps } from '../types/dashboard'

interface UsageData {
    usage: {
        total_requests: number
        total_tokens: number
        by_model: Record<string, { requests: number; tokens: number }>
        by_session: Record<string, { requests: number; tokens: number }>
    }
    sessions: {
        total: number
        active: number
    }
}

export function UsageView(_props: DashboardPageProps) {
    const [data, setData] = useState<UsageData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchUsage = async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/usage')
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setData(await res.json())
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchUsage() }, [])

    if (loading) return <div className="p-6 text-muted-foreground">Loading usage...</div>
    if (error) return <div className="p-6 text-destructive">Error: {error}</div>
    if (!data) return null

    const models = Object.entries(data.usage.by_model)
    const sessionEntries = Object.entries(data.usage.by_session)

    return (
        <div className="p-6 space-y-6 max-w-5xl">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Usage & Metrics</h2>
                <button
                    onClick={fetchUsage}
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                >
                    ↻ Refresh
                </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-xs text-muted-foreground mb-1">Total Requests</div>
                    <div className="text-2xl font-bold text-blue-400">{data.usage.total_requests}</div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-xs text-muted-foreground mb-1">Total Tokens</div>
                    <div className="text-2xl font-bold text-purple-400">{data.usage.total_tokens.toLocaleString()}</div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-xs text-muted-foreground mb-1">Total Sessions</div>
                    <div className="text-2xl font-bold text-emerald-400">{data.sessions.total}</div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-xs text-muted-foreground mb-1">Active Tasks</div>
                    <div className="text-2xl font-bold text-amber-400">{data.sessions.active}</div>
                </div>
            </div>

            {/* By Model */}
            <div className="rounded-lg border bg-card">
                <div className="px-4 py-3 border-b">
                    <h3 className="font-semibold">Usage by Model</h3>
                </div>
                {models.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No model-specific usage tracked yet.</div>
                ) : (
                    <div className="p-4 space-y-3">
                        {models.map(([model, stats]) => (
                            <div key={model} className="flex items-center gap-3">
                                <div className="flex-1">
                                    <div className="text-sm font-medium">{model}</div>
                                    <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
                                            style={{
                                                width: `${Math.min(
                                                    100,
                                                    data.usage.total_tokens > 0
                                                        ? (stats.tokens / data.usage.total_tokens) * 100
                                                        : 0
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className="text-right text-xs text-muted-foreground w-24">
                                    <div>{stats.requests} reqs</div>
                                    <div>{stats.tokens.toLocaleString()} tokens</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* By Session */}
            <div className="rounded-lg border bg-card">
                <div className="px-4 py-3 border-b">
                    <h3 className="font-semibold">Usage by Session</h3>
                </div>
                {sessionEntries.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No session-specific usage tracked yet.</div>
                ) : (
                    <div className="overflow-auto max-h-64">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/30">
                                <tr>
                                    <th className="text-left px-4 py-2 font-medium">Session</th>
                                    <th className="text-right px-4 py-2 font-medium">Requests</th>
                                    <th className="text-right px-4 py-2 font-medium">Tokens</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessionEntries.map(([id, stats]) => (
                                    <tr key={id} className="border-t">
                                        <td className="px-4 py-2 font-mono text-xs">{id.slice(0, 12)}...</td>
                                        <td className="px-4 py-2 text-right">{stats.requests}</td>
                                        <td className="px-4 py-2 text-right">{stats.tokens.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
