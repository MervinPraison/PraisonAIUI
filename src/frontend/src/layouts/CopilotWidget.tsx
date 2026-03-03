import { useState } from 'react'
import type { ChatConfig, LayoutConfig } from '../types'
import { ChatArea } from '../chat'

interface CopilotWidgetProps {
    config?: ChatConfig
    layout?: LayoutConfig
}

export function CopilotWidget({ config, layout }: CopilotWidgetProps) {
    const [isOpen, setIsOpen] = useState(false)
    const mode = layout?.mode || 'bottom-right'

    const positionClasses: Record<string, string> = {
        'bottom-right': 'bottom-4 right-4',
        'bottom-left': 'bottom-4 left-4',
        'top-right': 'top-4 right-4',
        'top-left': 'top-4 left-4',
    }

    const positionClass = positionClasses[mode] || positionClasses['bottom-right']

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className={`fixed ${positionClass} w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 flex items-center justify-center transition-transform hover:scale-105`}
                title="Open chat"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
            </button>
        )
    }

    return (
        <div
            className={`fixed ${positionClass} bg-background border rounded-lg shadow-xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200`}
            style={{
                width: layout?.width || '380px',
                height: layout?.height || '500px',
            }}
        >
            <header className="border-b px-3 py-2 flex items-center justify-between bg-muted/30">
                <h2 className="text-sm font-semibold">{config?.name || 'AI Assistant'}</h2>
                <button
                    onClick={() => setIsOpen(false)}
                    className="p-1 rounded hover:bg-accent"
                    title="Close"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                    </svg>
                </button>
            </header>
            <main className="flex-1 overflow-hidden">
                <ChatArea config={config} className="h-full" />
            </main>
        </div>
    )
}
