import { useCallback, useState } from 'react'
import type { ChatConfig } from '../types'
import { useSSE } from '../hooks/useSSE'

interface PlaygroundLayoutProps {
    config?: ChatConfig
    title?: string
}

export function PlaygroundLayout({ config, title }: PlaygroundLayoutProps) {
    const [input, setInput] = useState('')
    const [sessionId] = useState(() => `playground-${crypto.randomUUID()}`)

    const { isStreaming, currentResponse, thinkingSteps, sendMessage, cancel } = useSSE({
        externalSessionId: sessionId,
        onEnd: () => {
            // stream finished
        },
    })

    // Derive output from store state
    const output = currentResponse || thinkingSteps.join('\n')

    const handleSubmit = useCallback(async () => {
        if (!input.trim() || isStreaming) return
        sendMessage(input)
    }, [input, isStreaming, sendMessage])

    const handleClear = useCallback(() => {
        setInput('')
    }, [])

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            {/* Header */}
            <header className="border-b px-6 py-4 flex items-center justify-between">
                <h1 className="text-xl font-semibold">{title || 'Playground'}</h1>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleClear}
                        className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                    >
                        Clear
                    </button>
                </div>
            </header>

            {/* Main content - two panels */}
            <div className="flex-1 flex">
                {/* Input Panel */}
                <div className="flex-1 flex flex-col border-r">
                    <div className="px-4 py-2 border-b bg-muted/30">
                        <span className="text-sm font-medium text-muted-foreground">Input</span>
                    </div>
                    <div className="flex-1 p-4">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Enter your prompt here..."
                            className="w-full h-full resize-none bg-transparent border rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                    <div className="px-4 py-3 border-t flex justify-end gap-2">
                        {isStreaming ? (
                            <button
                                onClick={cancel}
                                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90"
                            >
                                Stop
                            </button>
                        ) : (
                            <button
                                onClick={handleSubmit}
                                disabled={!input.trim()}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Submit
                            </button>
                        )}
                    </div>
                </div>

                {/* Output Panel */}
                <div className="flex-1 flex flex-col">
                    <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">Output</span>
                        {isStreaming && (
                            <span className="text-xs text-muted-foreground animate-pulse">
                                Processing...
                            </span>
                        )}
                    </div>
                    <div className="flex-1 p-4 overflow-auto">
                        {output ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                                {output}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                                Output will appear here
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Settings Panel (optional - from config.widgets) */}
            {config?.features && (
                <div className="border-t px-6 py-3 bg-muted/20 flex items-center gap-4 text-sm text-muted-foreground">
                    {config.features.streaming && <span>✓ Streaming</span>}
                    {config.features.reasoning && <span>✓ Reasoning</span>}
                    {config.features.tools && <span>✓ Tools</span>}
                </div>
            )}
        </div>
    )
}
