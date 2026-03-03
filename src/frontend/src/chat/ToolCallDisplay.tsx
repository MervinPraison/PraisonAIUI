import { useState } from 'react'
import type { ToolCall } from '../types'

interface ToolCallDisplayProps {
    toolCall: ToolCall
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
    const [expanded, setExpanded] = useState(false)

    return (
        <div className="rounded-md border bg-muted/50 text-xs">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-2 w-full p-2 text-left hover:bg-accent/50"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground"
                >
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                <span className="font-medium">{toolCall.name}</span>
                {toolCall.error && (
                    <span className="text-destructive ml-auto">Error</span>
                )}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
                >
                    <path d="m6 9 6 6 6-6" />
                </svg>
            </button>
            {expanded && (
                <div className="p-2 border-t space-y-2">
                    {toolCall.args && Object.keys(toolCall.args).length > 0 && (
                        <div>
                            <span className="text-muted-foreground">Arguments:</span>
                            <pre className="mt-1 p-2 rounded bg-background overflow-x-auto">
                                {JSON.stringify(toolCall.args, null, 2)}
                            </pre>
                        </div>
                    )}
                    {toolCall.result !== undefined && (
                        <div>
                            <span className="text-muted-foreground">Result:</span>
                            <pre className="mt-1 p-2 rounded bg-background overflow-x-auto">
                                {typeof toolCall.result === 'string'
                                    ? toolCall.result
                                    : JSON.stringify(toolCall.result, null, 2)}
                            </pre>
                        </div>
                    )}
                    {toolCall.error && (
                        <div>
                            <span className="text-destructive">Error:</span>
                            <pre className="mt-1 p-2 rounded bg-destructive/10 text-destructive overflow-x-auto">
                                {toolCall.error}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
