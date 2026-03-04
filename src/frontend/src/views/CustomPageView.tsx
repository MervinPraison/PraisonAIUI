import { useEffect, useState } from 'react'
import type { DashboardPageProps } from '../types/dashboard'

interface KeyValue {
    label: string
    value: string | number | boolean
}

interface Section {
    title: string
    items: KeyValue[]
}

/**
 * Generic view for user-registered dashboard pages.
 *
 * Fetches data from the page's api_endpoint and renders it
 * as structured key-value sections, tables, or raw JSON.
 * This is the fallback renderer for pages that don't have
 * a built-in view component.
 */
export function CustomPageView({ page }: DashboardPageProps) {
    const [data, setData] = useState<Record<string, unknown> | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchData = async () => {
        try {
            setLoading(true)
            const res = await fetch(page.api_endpoint)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setData(await res.json())
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchData() }, [page.api_endpoint])

    if (loading) return <div className="p-6 text-muted-foreground">Loading {page.title}...</div>
    if (error) return <div className="p-6 text-destructive">Error: {error}</div>
    if (!data) return null

    // Try to auto-detect structure: sections, key-value pairs, or arrays
    const sections: Section[] = []
    const tables: { title: string; rows: Record<string, unknown>[] }[] = []
    const otherKeys: KeyValue[] = []

    for (const [key, value] of Object.entries(data)) {
        if (key === 'error') continue
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
            tables.push({ title: key, rows: value as Record<string, unknown>[] })
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const items = Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
                label: k,
                value: typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''),
            }))
            sections.push({ title: key, items })
        } else {
            otherKeys.push({
                label: key,
                value: typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''),
            })
        }
    }

    return (
        <div className="p-6 space-y-4 max-w-5xl">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">{page.title}</h2>
                <button
                    onClick={fetchData}
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                >
                    ↻ Refresh
                </button>
            </div>

            {/* Top-level key-value pairs as cards */}
            {otherKeys.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {otherKeys.map((kv) => (
                        <div key={kv.label} className="rounded-lg border bg-card p-4">
                            <div className="text-xs text-muted-foreground mb-1">{kv.label}</div>
                            <div className="text-lg font-bold text-blue-400">{String(kv.value)}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Object sections */}
            {sections.map((section) => (
                <div key={section.title} className="rounded-lg border bg-card">
                    <div className="px-4 py-3 border-b">
                        <h3 className="font-semibold capitalize">{section.title}</h3>
                    </div>
                    <div className="divide-y">
                        {section.items.map((item) => (
                            <div key={item.label} className="px-4 py-2.5 flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">{item.label}</span>
                                <span className="font-mono text-xs">{String(item.value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {/* Array sections as tables */}
            {tables.map((table) => {
                const cols = table.rows.length > 0 ? Object.keys(table.rows[0]) : []
                return (
                    <div key={table.title} className="rounded-lg border bg-card">
                        <div className="px-4 py-3 border-b">
                            <h3 className="font-semibold capitalize">{table.title}</h3>
                        </div>
                        <div className="overflow-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/30">
                                    <tr>
                                        {cols.map((col) => (
                                            <th key={col} className="text-left px-4 py-2 font-medium capitalize">
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {table.rows.map((row, i) => (
                                        <tr key={i} className="border-t">
                                            {cols.map((col) => (
                                                <td key={col} className="px-4 py-2">
                                                    {typeof row[col] === 'object'
                                                        ? JSON.stringify(row[col])
                                                        : String(row[col] ?? '')}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
