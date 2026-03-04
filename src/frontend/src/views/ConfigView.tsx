import { useEffect, useState } from 'react'
import type { DashboardPageProps } from '../types/dashboard'

interface ConfigData {
    config: Record<string, unknown>
    config_path: string | null
}

export function ConfigView(_props: DashboardPageProps) {
    const [data, setData] = useState<ConfigData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [editText, setEditText] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)

    const fetchConfig = async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/config')
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setData(json)
            setEditText(JSON.stringify(json.config, null, 2))
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchConfig() }, [])

    const saveConfig = async () => {
        try {
            setSaving(true)
            setSaveMsg(null)
            const parsed = JSON.parse(editText)
            const res = await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: parsed }),
            })
            const result = await res.json()
            if (res.ok) {
                setSaveMsg('✅ Saved successfully')
                setEditMode(false)
                fetchConfig()
            } else {
                setSaveMsg(`❌ ${result.error || 'Save failed'}`)
            }
        } catch (err) {
            setSaveMsg(`❌ ${err instanceof Error ? err.message : 'Invalid JSON'}`)
        } finally {
            setSaving(false)
        }
    }

    if (loading) return <div className="p-6 text-muted-foreground">Loading config...</div>
    if (error) return <div className="p-6 text-destructive">Error: {error}</div>
    if (!data) return null

    return (
        <div className="p-6 space-y-4 max-w-5xl">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold">Configuration</h2>
                    <p className="text-xs text-muted-foreground">
                        {data.config_path ? `File: ${data.config_path}` : 'No config file (in-memory only)'}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={fetchConfig}
                        className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                    >
                        ↻
                    </button>
                    {!editMode ? (
                        <button
                            onClick={() => setEditMode(true)}
                            className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                        >
                            ✏ Edit
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={saveConfig}
                                disabled={saving}
                                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                            >
                                {saving ? 'Saving...' : '💾 Save'}
                            </button>
                            <button
                                onClick={() => {
                                    setEditMode(false)
                                    setEditText(JSON.stringify(data.config, null, 2))
                                }}
                                className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                            >
                                Cancel
                            </button>
                        </>
                    )}
                </div>
            </div>

            {saveMsg && (
                <div className="text-sm px-3 py-2 rounded border">{saveMsg}</div>
            )}

            {editMode ? (
                <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full h-[500px] font-mono text-sm p-4 rounded-lg border bg-background resize-y"
                    spellCheck={false}
                />
            ) : (
                <div className="rounded-lg border bg-card">
                    <pre className="p-4 text-sm font-mono overflow-auto max-h-[600px]">
                        {JSON.stringify(data.config, null, 2) || '{}'}
                    </pre>
                </div>
            )}
        </div>
    )
}
