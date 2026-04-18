import { useState, useCallback, useEffect } from 'react'

interface Action {
    name: string
    label: string
    icon?: string
}

interface AskActionPromptProps {
    content: string
    actions: Action[]
    timeout: number
    onSubmit: (action: Action) => void
    onTimeout: () => void
}

export function AskActionPrompt({
    content,
    actions,
    timeout,
    onSubmit,
    onTimeout,
}: AskActionPromptProps) {
    const [timeLeft, setTimeLeft] = useState(timeout)
    const [selectedAction, setSelectedAction] = useState<Action | null>(null)

    // Timeout countdown
    useEffect(() => {
        const interval = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(interval)
                    onTimeout()
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => clearInterval(interval)
    }, [onTimeout])

    const handleActionClick = useCallback((action: Action) => {
        setSelectedAction(action)
        // Small delay to show selection before submitting
        setTimeout(() => {
            onSubmit(action)
        }, 150)
    }, [onSubmit])

    const formatTime = useCallback((seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }, [])

    return (
        <div className="ask-action-prompt max-w-md mx-auto bg-white border border-gray-200 rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-medium text-gray-900 mb-4">{content}</h3>
            
            {/* Timeout indicator */}
            <div className="mb-6 text-center">
                <div className="text-sm text-gray-500 mb-2">
                    Time remaining: {formatTime(timeLeft)}
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-1000"
                        style={{ width: `${timeout > 0 ? (timeLeft / timeout) * 100 : 0}%` }}
                    />
                </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
                {actions.map((action, index) => (
                    <button
                        key={action.name}
                        type="button"
                        onClick={() => handleActionClick(action)}
                        disabled={selectedAction !== null}
                        className={`w-full p-4 text-left rounded-lg border-2 transition-all ${
                            selectedAction?.name === action.name
                                ? 'border-green-500 bg-green-50 text-green-800'
                                : selectedAction !== null
                                ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                                : 'border-gray-200 hover:border-blue-500 hover:bg-blue-50 focus:border-blue-500 focus:outline-none'
                        }`}
                    >
                        <div className="flex items-center">
                            {action.icon && (
                                <span className="text-xl mr-3" role="img" aria-label={action.label}>
                                    {action.icon}
                                </span>
                            )}
                            <div>
                                <div className="font-medium">{action.label}</div>
                                <div className="text-sm text-gray-500 mt-1">
                                    Action: {action.name}
                                </div>
                            </div>
                            {selectedAction?.name === action.name && (
                                <div className="ml-auto">
                                    <svg 
                                        className="w-6 h-6 text-green-600" 
                                        fill="none" 
                                        stroke="currentColor" 
                                        viewBox="0 0 24 24"
                                    >
                                        <path 
                                            strokeLinecap="round" 
                                            strokeLinejoin="round" 
                                            strokeWidth={2} 
                                            d="M5 13l4 4L19 7" 
                                        />
                                    </svg>
                                </div>
                            )}
                        </div>
                    </button>
                ))}
            </div>

            {/* Cancel button */}
            <div className="mt-6">
                <button
                    type="button"
                    onClick={onTimeout}
                    disabled={selectedAction !== null}
                    className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                    Cancel
                </button>
            </div>

            {/* Progress indicator when action selected */}
            {selectedAction && (
                <div className="mt-4 text-center">
                    <div className="inline-flex items-center text-green-600">
                        <svg className="animate-spin -ml-1 mr-3 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"></circle>
                            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" opacity="0.75"></path>
                        </svg>
                        Processing...
                    </div>
                </div>
            )}
        </div>
    )
}