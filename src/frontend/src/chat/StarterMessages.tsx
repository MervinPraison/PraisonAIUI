import type { ChatStarter } from '../types'

interface StarterMessagesProps {
    starters: ChatStarter[]
    onStarterClick: (message: string) => void
}

export function StarterMessages({ starters, onStarterClick }: StarterMessagesProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full py-12">
            <h2 className="text-2xl font-semibold mb-2">How can I help you today?</h2>
            <p className="text-muted-foreground mb-8">Choose a starter or type your own message</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full px-4">
                {starters.map((starter, index) => (
                    <button
                        key={index}
                        onClick={() => onStarterClick(starter.message)}
                        className="flex items-center gap-3 p-4 rounded-lg border bg-card hover:bg-accent text-left transition-colors"
                    >
                        {starter.icon && (
                            <span className="text-2xl">{starter.icon}</span>
                        )}
                        <span className="text-sm font-medium">{starter.label}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}
