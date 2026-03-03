import { useState, useCallback } from 'react'
import type { InputWidget } from '../types'

interface WidgetPanelProps {
    widgets: InputWidget[]
    onChange?: (name: string, value: unknown) => void
    className?: string
}

export function WidgetPanel({ widgets, onChange, className = '' }: WidgetPanelProps) {
    const [values, setValues] = useState<Record<string, unknown>>(() => {
        const initial: Record<string, unknown> = {}
        for (const widget of widgets) {
            initial[widget.name] = widget.default
        }
        return initial
    })

    const handleChange = useCallback((name: string, value: unknown) => {
        setValues((prev) => ({ ...prev, [name]: value }))
        onChange?.(name, value)
    }, [onChange])

    if (widgets.length === 0) return null

    return (
        <div className={`space-y-4 p-4 border rounded-lg bg-card ${className}`}>
            <h3 className="text-sm font-semibold">Settings</h3>
            <div className="space-y-3">
                {widgets.map((widget) => (
                    <WidgetInput
                        key={widget.name}
                        widget={widget}
                        value={values[widget.name]}
                        onChange={(value) => handleChange(widget.name, value)}
                    />
                ))}
            </div>
        </div>
    )
}

interface WidgetInputProps {
    widget: InputWidget
    value: unknown
    onChange: (value: unknown) => void
}

function WidgetInput({ widget, value, onChange }: WidgetInputProps) {
    const label = widget.label || widget.name

    switch (widget.type) {
        case 'slider':
            return (
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <label className="text-sm">{label}</label>
                        <span className="text-xs text-muted-foreground">{String(value)}</span>
                    </div>
                    <input
                        type="range"
                        min={widget.min ?? 0}
                        max={widget.max ?? 100}
                        step={widget.step ?? 1}
                        value={Number(value) || 0}
                        onChange={(e) => onChange(Number(e.target.value))}
                        className="w-full"
                    />
                </div>
            )

        case 'select':
            return (
                <div className="space-y-1">
                    <label className="text-sm">{label}</label>
                    <select
                        value={String(value) || ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                    >
                        {widget.options?.map((option) => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </select>
                </div>
            )

        case 'switch':
            return (
                <div className="flex items-center justify-between">
                    <label className="text-sm">{label}</label>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(value)}
                        onClick={() => onChange(!value)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            value ? 'bg-primary' : 'bg-muted'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                value ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>
            )

        case 'text':
            return (
                <div className="space-y-1">
                    <label className="text-sm">{label}</label>
                    <input
                        type="text"
                        value={String(value) || ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                    />
                </div>
            )

        case 'number':
            return (
                <div className="space-y-1">
                    <label className="text-sm">{label}</label>
                    <input
                        type="number"
                        min={widget.min}
                        max={widget.max}
                        step={widget.step}
                        value={Number(value) || 0}
                        onChange={(e) => onChange(Number(e.target.value))}
                        className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                    />
                </div>
            )

        case 'color':
            return (
                <div className="space-y-1">
                    <label className="text-sm">{label}</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="color"
                            value={String(value) || '#000000'}
                            onChange={(e) => onChange(e.target.value)}
                            className="w-8 h-8 rounded border cursor-pointer"
                        />
                        <span className="text-xs text-muted-foreground">{String(value)}</span>
                    </div>
                </div>
            )

        default:
            return null
    }
}
