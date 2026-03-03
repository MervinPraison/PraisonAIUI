import { useState } from 'react'

interface ThinkingStepsProps {
    steps: string[]
    collapsed?: boolean
}

export function ThinkingSteps({ steps, collapsed = false }: ThinkingStepsProps) {
    const [expanded, setExpanded] = useState(!collapsed)

    if (steps.length === 0) return null

    return (
        <div className="rounded-md border bg-muted/30 text-xs mb-2">
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
                    className="text-muted-foreground animate-pulse"
                >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4" />
                    <path d="M12 8h.01" />
                </svg>
                <span className="font-medium text-muted-foreground">
                    Thinking ({steps.length} step{steps.length > 1 ? 's' : ''})
                </span>
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
                <div className="p-2 border-t space-y-1">
                    {steps.map((step, index) => (
                        <div key={index} className="flex items-start gap-2">
                            <span className="text-muted-foreground">{index + 1}.</span>
                            <span>{step}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
