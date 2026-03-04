import { useEffect, useState } from 'react'
import type { DashboardPageProps } from '../types/dashboard'

interface AgentInfo {
    name: string
    created_at: string
}

export function AgentsView(_props: DashboardPageProps) {
    const [agents, setAgents] = useState<AgentInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

    const fetchAgents = async () => {
        try {
            setLoading(true)
            const res = await fetch('/agents')
            if (!res.ok) throw new Error(`HTTP ${res.status} `)
            const data = await res.json()
            setAgents(data.agents || [])
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchAgents() }, [])

    if (loading) return <div className="p-6 text-muted-foreground">Loading agents...</div>
    if (error) return <div className="p-6 text-destructive">Error: {error}</div>

    return (
        <div className="p-6 space-y-4 max-w-5xl">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Agents ({agents.length})</h2>
                <button
                    onClick={fetchAgents}
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                >
                    ↻ Refresh
                </button>
            </div>

            {agents.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                    No agents registered. Register agents in your app.py configuration.
                </div>
            ) : (
                <div className="grid gap-3">
                    {agents.map((agent) => (
                        <div
                            key={agent.name}
                            onClick={() => setSelectedAgent(selectedAgent === agent.name ? null : agent.name)}
                            className={`rounded - lg border p - 4 cursor - pointer transition - colors ${selectedAgent === agent.name ? 'border-blue-500 bg-accent' : 'hover:bg-accent/50'
                                } `}
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
                                    {agent.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1">
                                    <div className="font-semibold">{agent.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        Registered {new Date(agent.created_at).toLocaleString()}
                                    </div>
                                </div>
                                <span className="w-2 h-2 rounded-full bg-green-500" title="Active" />
                            </div>

                            {selectedAgent === agent.name && (
                                <div className="mt-3 pt-3 border-t space-y-2">
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div className="rounded border p-2">
                                            <div className="text-xs text-muted-foreground">Status</div>
                                            <div className="text-green-500 font-medium">Active</div>
                                        </div>
                                        <div className="rounded border p-2">
                                            <div className="text-xs text-muted-foreground">Type</div>
                                            <div>AI Agent</div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
