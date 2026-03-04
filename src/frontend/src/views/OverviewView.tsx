import { useEffect, useState } from 'react'
import type { DashboardPageProps } from '../types/dashboard'

interface OverviewData {
    status: string
    version: string
    uptime_seconds: number
    python_version: string
    stats: {
        total_sessions: number
        active_tasks: number
        registered_agents: number
        registered_profiles: number
        total_requests: number
    }
    agents: string[]
}

export function OverviewView({ onNavigate }: DashboardPageProps) {
    const [data, setData] = useState<OverviewData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchOverview = async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/overview')
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setData(await res.json())
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchOverview() }, [])

    const formatUptime = (s: number) => {
        const h = Math.floor(s / 3600)
        const m = Math.floor((s % 3600) / 60)
        return h > 0 ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`
    }

    if (loading) return <div className="p-6 text-muted-foreground">Loading overview...</div>
    if (error) return <div className="p-6 text-destructive">Error: {error}</div>
    if (!data) return null

    const cards = [
        { label: 'Status', value: data.status === 'ok' ? '✅ Healthy' : '❌ Error', color: 'text-green-500' },
        { label: 'Version', value: data.version, color: 'text-blue-400' },
        { label: 'Uptime', value: formatUptime(data.uptime_seconds), color: 'text-amber-400' },
        { label: 'Sessions', value: String(data.stats.total_sessions), color: 'text-purple-400' },
        { label: 'Agents', value: String(data.stats.registered_agents), color: 'text-cyan-400' },
        { label: 'Profiles', value: String(data.stats.registered_profiles), color: 'text-pink-400' },
        { label: 'Active Tasks', value: String(data.stats.active_tasks), color: 'text-orange-400' },
        { label: 'Total Requests', value: String(data.stats.total_requests), color: 'text-emerald-400' },
    ]

    return (
        <div className="p-6 space-y-6 max-w-5xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Dashboard Overview</h2>
                    <p className="text-sm text-muted-foreground">System health and activity</p>
                </div>
                <button
                    onClick={fetchOverview}
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                >
                    ↻ Refresh
                </button>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {cards.map((card) => (
                    <div key={card.label} className="rounded-lg border bg-card p-4">
                        <div className="text-xs text-muted-foreground mb-1">{card.label}</div>
                        <div className={`text-xl font-bold ${card.color}`}>{card.value}</div>
                    </div>
                ))}
            </div>

            {/* Agents list */}
            <div className="rounded-lg border bg-card">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                    <h3 className="font-semibold">Registered Agents</h3>
                    <button
                        onClick={() => onNavigate('agents')}
                        className="text-xs text-blue-400 hover:underline"
                    >
                        View all →
                    </button>
                </div>
                <div className="p-4 grid grid-cols-2 gap-2">
                    {data.agents.map((name) => (
                        <div key={name} className="flex items-center gap-2 text-sm">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            {name}
                        </div>
                    ))}
                    {data.agents.length === 0 && (
                        <p className="text-sm text-muted-foreground col-span-2">No agents registered</p>
                    )}
                </div>
            </div>

            {/* Quick links */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { tab: 'sessions', label: 'Sessions', icon: '📋' },
                    { tab: 'agents', label: 'Agents', icon: '🤖' },
                    { tab: 'config', label: 'Config', icon: '⚙️' },
                    { tab: 'logs', label: 'Logs', icon: '📜' },
                ].map((link) => (
                    <button
                        key={link.tab}
                        onClick={() => onNavigate(link.tab)}
                        className="rounded-lg border p-3 text-left hover:bg-accent transition-colors"
                    >
                        <span className="text-lg">{link.icon}</span>
                        <div className="text-sm font-medium mt-1">{link.label}</div>
                    </button>
                ))}
            </div>

            {/* Python info */}
            <div className="text-xs text-muted-foreground">
                Python {data.python_version.split('|')[0].trim()}
            </div>
        </div>
    )
}
