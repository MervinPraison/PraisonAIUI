import type { ChatConfig, LayoutConfig } from '../types'
import { ChatArea } from '../chat'

interface ChatLayoutProps {
    config?: ChatConfig
    layout?: LayoutConfig
    title?: string
}

export function ChatLayout({ config, layout, title }: ChatLayoutProps) {
    const mode = layout?.mode || 'fullscreen'

    if (mode === 'fullscreen') {
        return (
            <div className="flex flex-col h-screen bg-background">
                <header className="border-b px-4 py-3 flex items-center gap-3">
                    <h1 className="text-lg font-semibold">{title || config?.name || 'AI Chat'}</h1>
                </header>
                <main className="flex-1 overflow-hidden">
                    <ChatArea config={config} className="h-full" />
                </main>
            </div>
        )
    }

    if (mode === 'sidebar') {
        return (
            <div
                className="fixed right-0 top-0 h-screen border-l bg-background shadow-lg flex flex-col"
                style={{ width: layout?.width || '400px' }}
            >
                <header className="border-b px-4 py-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">{config?.name || 'AI Chat'}</h2>
                </header>
                <main className="flex-1 overflow-hidden">
                    <ChatArea config={config} className="h-full" />
                </main>
            </div>
        )
    }

    // Floating widget modes (bottom-right, bottom-left, top-right, top-left)
    const positionClasses: Record<string, string> = {
        'bottom-right': 'bottom-4 right-4',
        'bottom-left': 'bottom-4 left-4',
        'top-right': 'top-4 right-4',
        'top-left': 'top-4 left-4',
    }

    const positionClass = positionClasses[mode] || positionClasses['bottom-right']

    return (
        <div
            className={`fixed ${positionClass} bg-background border rounded-lg shadow-xl flex flex-col overflow-hidden`}
            style={{
                width: layout?.width || '380px',
                height: layout?.height || '500px',
            }}
        >
            <header className="border-b px-3 py-2 flex items-center justify-between bg-muted/30">
                <h2 className="text-sm font-semibold">{config?.name || 'AI Chat'}</h2>
            </header>
            <main className="flex-1 overflow-hidden">
                <ChatArea config={config} className="h-full" />
            </main>
        </div>
    )
}
