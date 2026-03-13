import { useState } from 'react'
import type { ToolCall } from '../types'

interface ToolCallDisplayProps {
    toolCall: ToolCall
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
    const [expanded, setExpanded] = useState(false)

    const isRunning = toolCall.status === 'running'
    const displayLabel = toolCall.description || toolCall.name

    return (
        <div className="rounded-md border bg-muted/50 text-xs">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-2 w-full p-2 text-left hover:bg-accent/50"
            >
                {/* Status indicator */}
                {isRunning ? (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                ) : (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                )}

                {/* Step number badge */}
                {toolCall.step_number && (
                    <span className="text-[10px] font-medium text-muted-foreground bg-background rounded px-1.5 py-0.5 shrink-0">
                        Step {toolCall.step_number}
                    </span>
                )}

                {/* Icon + Description */}
                <span className="font-medium truncate">
                    {toolCall.icon && <span className="mr-1">{toolCall.icon}</span>}
                    {displayLabel}
                </span>

                {toolCall.error && (
                    <span className="text-destructive ml-auto shrink-0">Error</span>
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
                    className={`ml-auto shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
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
                    {toolCall.formatted_result ? (
                        <div>
                            <span className="text-muted-foreground">Result:</span>
                            <pre className="mt-1 p-2 rounded bg-background overflow-x-auto whitespace-pre-wrap">
                                {toolCall.formatted_result}
                            </pre>
                        </div>
                    ) : toolCall.result !== undefined ? (
                        <div>
                            <span className="text-muted-foreground">Result:</span>
                            <pre className="mt-1 p-2 rounded bg-background overflow-x-auto">
                                {typeof toolCall.result === 'string'
                                    ? toolCall.result
                                    : JSON.stringify(toolCall.result, null, 2)}
                            </pre>
                        </div>
                    ) : null}
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
