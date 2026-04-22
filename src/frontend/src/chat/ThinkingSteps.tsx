import { useState } from 'react'
import type { ReasoningStep } from '../types'

interface ThinkingStepsProps {
    steps: (string | ReasoningStep)[]
    collapsed?: boolean
}

function getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'bg-green-100 text-green-800 border-green-200'
    if (confidence >= 0.5) return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    return 'bg-red-100 text-red-800 border-red-200'
}

function ConfidenceChip({ confidence }: { confidence: number }) {
    const colorClasses = getConfidenceColor(confidence)
    const percentage = Math.round(confidence * 100)
    
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${colorClasses}`}>
            {percentage}%
        </span>
    )
}

function StepCard({ step, index }: { step: string | ReasoningStep; index: number }) {
    if (typeof step === 'string') {
        // Legacy string format
        return (
            <div className="flex items-start gap-2">
                <span className="text-muted-foreground">{index + 1}.</span>
                <span>{step}</span>
            </div>
        )
    }

    // Rich ReasoningStep format
    return (
        <div className="space-y-2 p-2 rounded border-l-2 border-l-blue-200 bg-blue-50/50">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1">
                    <span className="text-muted-foreground">{index + 1}.</span>
                    <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{step.title}</span>
                            {step.action && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                    {step.action}
                                </span>
                            )}
                        </div>
                        {step.reasoning && (
                            <div className="text-xs text-muted-foreground">{step.reasoning}</div>
                        )}
                        {step.result && (
                            <div className="text-xs bg-gray-50 p-1.5 rounded border">{step.result}</div>
                        )}
                        {step.next_action && (
                            <div className="text-xs text-blue-600">
                                <span className="font-medium">Next:</span> {step.next_action}
                            </div>
                        )}
                    </div>
                </div>
                {step.confidence !== undefined && (
                    <ConfidenceChip confidence={step.confidence} />
                )}
            </div>
        </div>
    )
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
                <div className="p-2 border-t space-y-2">
                    {steps.map((step, index) => (
                        <StepCard key={index} step={step} index={index} />
                    ))}
                </div>
            )}
        </div>
    )
}
