import { useEffect, useState, useRef, useCallback } from 'react'
import type { DashboardPageProps } from '../types/dashboard'

interface LogEntry {
    timestamp: string
    level: string
    logger: string
    message: string
}

export function LogsView(_props: DashboardPageProps) {
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [levelFilter, setLevelFilter] = useState('')
    const [autoRefresh, setAutoRefresh] = useState(true)
    const [total, setTotal] = useState(0)
    const scrollRef = useRef<HTMLDivElement>(null)

    const fetchLogs = useCallback(async () => {
        try {
            const params = new URLSearchParams()
            if (levelFilter) params.set('level', levelFilter)
            params.set('limit', '200')
            const res = await fetch(`/api/logs?${params}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setLogs(data.logs || [])
            setTotal(data.total || 0)
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }, [levelFilter])

    // Initial load
    useEffect(() => { fetchLogs() }, [fetchLogs])

    // Auto-refresh every 3 seconds
    useEffect(() => {
        if (!autoRefresh) return
        const interval = setInterval(fetchLogs, 3000)
        return () => clearInterval(interval)
    }, [autoRefresh, fetchLogs])

    // Auto-scroll to bottom
    useEffect(() => {
        if (autoRefresh && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [logs, autoRefresh])

    const levelColor = (level: string) => {
        switch (level) {
            case 'ERROR': return 'text-red-500'
            case 'WARNING': return 'text-amber-500'
            case 'INFO': return 'text-blue-400'
            case 'DEBUG': return 'text-gray-400'
            default: return 'text-foreground'
        }
    }

    if (loading) return <div className="p-6 text-muted-foreground">Loading logs...</div>
    if (error) return <div className="p-6 text-destructive">Error: {error}</div>

    return (
        <div className="p-6 space-y-4 max-w-5xl h-full flex flex-col">
            {/* Controls */}
            <div className="flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold">Logs</h2>
                    <span className="text-xs text-muted-foreground">({total} total)</span>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={levelFilter}
                        onChange={(e) => setLevelFilter(e.target.value)}
                        className="px-2 py-1.5 text-sm rounded-md border bg-background"
                    >
                        <option value="">All levels</option>
                        <option value="ERROR">ERROR</option>
                        <option value="WARNING">WARNING</option>
                        <option value="INFO">INFO</option>
                        <option value="DEBUG">DEBUG</option>
                    </select>
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`px-3 py-1.5 text-sm rounded-md border ${autoRefresh ? 'bg-green-500/20 border-green-500' : ''
                            }`}
                    >
                        {autoRefresh ? '⏸ Pause' : '▶ Auto'}
                    </button>
                    <button
                        onClick={fetchLogs}
                        className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                    >
                        ↻
                    </button>
                </div>
            </div>

            {/* Log entries */}
            <div
                ref={scrollRef}
                className="flex-1 rounded-lg border bg-black/30 font-mono text-xs overflow-auto min-h-[200px]"
            >
                {logs.length === 0 ? (
                    <div className="p-6 text-center text-muted-foreground">
                        No log entries captured yet. Logs will appear here as the server processes requests.
                    </div>
                ) : (
                    <div className="p-2 space-y-0.5">
                        {logs.map((entry, i) => (
                            <div key={i} className="flex gap-2 hover:bg-white/5 px-1 py-0.5 rounded">
                                <span className="text-muted-foreground whitespace-nowrap">
                                    {entry.timestamp.split('T')[1]?.slice(0, 8) || entry.timestamp}
                                </span>
                                <span className={`font-bold w-14 ${levelColor(entry.level)}`}>
                                    {entry.level.padEnd(7)}
                                </span>
                                <span className="text-muted-foreground w-24 truncate" title={entry.logger}>
                                    {entry.logger}
                                </span>
                                <span className="flex-1 break-all">{entry.message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
