import { useState } from 'react'

interface StepProps {
    id: string
    name: string
    type: 'tool_call' | 'reasoning' | 'sub_agent' | 'retrieval' | 'custom'
    status: 'running' | 'completed' | 'error'
    parentId?: string
    duration?: number
    content?: string
    input?: string
    output?: string
    error?: string
    metadata?: Record<string, unknown>
    children?: StepProps[]
    collapsed?: boolean
}

export function StepDisplay({ step }: { step: StepProps }) {
    const [expanded, setExpanded] = useState(!step.collapsed)

    const typeIcons = {
        tool_call: '🔧',
        reasoning: '🧠',
        sub_agent: '🤖',
        retrieval: '📚',
        custom: '⚙️'
    }

    const statusIndicator = {
        running: <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />,
        completed: <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />,
        error: <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
    }

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${Math.round(ms)}ms`
        return `${(ms / 1000).toFixed(1)}s`
    }

    return (
        <div className="rounded-md border bg-muted/30 text-xs mb-2">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-2 w-full p-2 text-left hover:bg-accent/50"
            >
                {statusIndicator[step.status]}
                
                <span className="text-sm shrink-0">
                    {typeIcons[step.type]}
                </span>
                
                <span className="font-medium truncate">
                    {step.name}
                </span>
                
                {step.duration && step.status === 'completed' && (
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                        {formatDuration(step.duration * 1000)}
                    </span>
                )}
                
                {step.error && (
                    <span className="text-destructive text-xs ml-auto shrink-0">Error</span>
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
                    {step.input && (
                        <div>
                            <span className="text-muted-foreground text-xs font-medium">Input:</span>
                            <pre className="mt-1 p-2 rounded bg-background text-xs overflow-x-auto whitespace-pre-wrap">
                                {step.input}
                            </pre>
                        </div>
                    )}
                    
                    {step.content && (
                        <div>
                            <span className="text-muted-foreground text-xs font-medium">Content:</span>
                            <div className="mt-1 p-2 rounded bg-background text-xs overflow-x-auto whitespace-pre-wrap">
                                {step.content}
                            </div>
                        </div>
                    )}
                    
                    {step.output && (
                        <div>
                            <span className="text-muted-foreground text-xs font-medium">Output:</span>
                            <pre className="mt-1 p-2 rounded bg-background text-xs overflow-x-auto whitespace-pre-wrap">
                                {step.output}
                            </pre>
                        </div>
                    )}
                    
                    {step.error && (
                        <div>
                            <span className="text-destructive text-xs font-medium">Error:</span>
                            <pre className="mt-1 p-2 rounded bg-destructive/10 text-destructive text-xs overflow-x-auto">
                                {step.error}
                            </pre>
                        </div>
                    )}
                    
                    {step.metadata && Object.keys(step.metadata).length > 0 && (
                        <div>
                            <span className="text-muted-foreground text-xs font-medium">Metadata:</span>
                            <pre className="mt-1 p-2 rounded bg-background text-xs overflow-x-auto">
                                {JSON.stringify(step.metadata, null, 2)}
                            </pre>
                        </div>
                    )}
                    
                    {/* Nested steps */}
                    {step.children && step.children.length > 0 && (
                        <div className="ml-4 space-y-2">
                            {step.children.map((childStep) => (
                                <StepDisplay key={childStep.id} step={childStep} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// Container for managing multiple steps with hierarchy
export function StepsContainer({ 
    steps, 
    title = "Steps",
    collapsed = false 
}: { 
    steps: StepProps[]
    title?: string
    collapsed?: boolean 
}) {
    const [expanded, setExpanded] = useState(!collapsed)

    // Build step hierarchy from flat list
    const buildHierarchy = (flatSteps: StepProps[]): StepProps[] => {
        const stepMap = new Map<string, StepProps>()
        const rootSteps: StepProps[] = []

        // First pass: create map of all steps
        flatSteps.forEach(step => {
            stepMap.set(step.id, { ...step, children: [] })
        })

        // Second pass: organize hierarchy
        flatSteps.forEach(step => {
            const stepNode = stepMap.get(step.id)!
            if (step.parentId && stepMap.has(step.parentId)) {
                const parent = stepMap.get(step.parentId)!
                if (!parent.children) parent.children = []
                parent.children.push(stepNode)
            } else {
                rootSteps.push(stepNode)
            }
        })

        return rootSteps
    }

    const hierarchicalSteps = buildHierarchy(steps)

    if (steps.length === 0) return null

    const activeSteps = steps.filter(s => s.status === 'running')
    const completedSteps = steps.filter(s => s.status === 'completed')
    const errorSteps = steps.filter(s => s.status === 'error')

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
                    className={`text-muted-foreground ${activeSteps.length > 0 ? 'animate-pulse' : ''}`}
                >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4" />
                    <path d="M12 8h.01" />
                </svg>
                
                <span className="font-medium text-muted-foreground">
                    {title} ({steps.length} step{steps.length > 1 ? 's' : ''})
                </span>
                
                <div className="flex items-center gap-1 ml-auto">
                    {activeSteps.length > 0 && (
                        <span className="text-primary text-xs">{activeSteps.length} running</span>
                    )}
                    {errorSteps.length > 0 && (
                        <span className="text-destructive text-xs">{errorSteps.length} error</span>
                    )}
                    {completedSteps.length > 0 && (
                        <span className="text-green-600 text-xs">{completedSteps.length} done</span>
                    )}
                </div>
                
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
                    className={`ml-2 transition-transform ${expanded ? 'rotate-180' : ''}`}
                >
                    <path d="m6 9 6 6 6-6" />
                </svg>
            </button>
            
            {expanded && (
                <div className="p-2 border-t space-y-2">
                    {hierarchicalSteps.map((step) => (
                        <StepDisplay key={step.id} step={step} />
                    ))}
                </div>
            )}
        </div>
    )
}