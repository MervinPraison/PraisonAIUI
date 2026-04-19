import { useState, useCallback } from 'react'
import type { ActionButton } from '../types'

// Simple toast notification function
function showToast(message: string, type: 'error' | 'success' = 'error') {
    const toast = document.createElement('div')
    toast.textContent = message
    toast.className = `fixed top-4 right-4 z-50 px-4 py-2 rounded-md text-white max-w-sm transition-opacity duration-300 ${
        type === 'error' ? 'bg-red-500' : 'bg-green-500'
    }`
    document.body.appendChild(toast)
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
        toast.style.opacity = '0'
        setTimeout(() => {
            document.body.removeChild(toast)
        }, 300)
    }, 4000)
}

interface ActionButtonsProps {
    actions: ActionButton[]
    messageId: string
    sessionId?: string
}

/**
 * ActionButtons component renders interactive action buttons attached to messages.
 * When clicked, these buttons trigger server-side callbacks registered with @action_callback.
 * 
 * Features:
 * - Supports different button variants (primary, secondary, destructive, ghost, outline)
 * - Handles click events with proper payload forwarding
 * - Disables buttons while requests are pending
 * - Removes buttons when action.remove() is called from server
 * - Proper error handling and user feedback
 */
export function ActionButtons({ actions, messageId, sessionId }: ActionButtonsProps) {
    const [pendingActions, setPendingActions] = useState<Set<string>>(new Set())
    const [hiddenActions, setHiddenActions] = useState<Set<string>>(new Set())

    const handleActionClick = useCallback(async (action: ActionButton) => {
        if (pendingActions.has(action.id) || hiddenActions.has(action.id)) {
            return
        }

        // Mark action as pending
        setPendingActions(prev => new Set(prev).add(action.id))

        try {
            const response = await fetch(`/api/actions/${action.id}/click`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action_name: action.name,
                    payload: action.payload,
                    message_id: messageId,
                    session_id: sessionId || new URLSearchParams(window.location.search).get('session') || 'default',
                }),
            })

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.error || `HTTP ${response.status}`)
            }

            // Success - the server-side callback has executed
            console.log(`Action '${action.name}' executed successfully`)
            
        } catch (error) {
            console.error(`Failed to execute action '${action.name}':`, error)
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
            showToast(`Failed to execute action "${action.label}": ${errorMessage}`)
        } finally {
            // Remove pending state
            setPendingActions(prev => {
                const newSet = new Set(prev)
                newSet.delete(action.id)
                return newSet
            })
        }
    }, [messageId, sessionId, pendingActions, hiddenActions])

    // Filter out hidden actions (removed via action.remove())
    const visibleActions = actions.filter(action => !hiddenActions.has(action.id))

    if (visibleActions.length === 0) {
        return null
    }

    return (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Message actions">
            {visibleActions.map((action) => (
                <ActionButton
                    key={action.id}
                    action={action}
                    pending={pendingActions.has(action.id)}
                    onClick={() => handleActionClick(action)}
                />
            ))}
        </div>
    )
}

interface SingleActionButtonProps {
    action: ActionButton
    pending: boolean
    onClick: () => void
}

function ActionButton({ action, pending, onClick }: SingleActionButtonProps) {
    // Map action variant to appropriate CSS classes
    const getVariantClasses = (variant: string = 'secondary') => {
        switch (variant) {
            case 'primary':
                return 'bg-primary text-primary-foreground hover:bg-primary/90'
            case 'destructive':
                return 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            case 'ghost':
                return 'hover:bg-accent hover:text-accent-foreground'
            case 'outline':
                return 'border border-input bg-background hover:bg-accent hover:text-accent-foreground'
            case 'secondary':
            default:
                return 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
        }
    }

    const baseClasses = 'inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'
    const variantClasses = getVariantClasses(action.variant)

    return (
        <button
            onClick={onClick}
            disabled={pending}
            className={`${baseClasses} ${variantClasses}`}
            title={pending ? 'Processing...' : `Click to ${action.label.toLowerCase()}`}
            aria-label={`${action.label} action`}
        >
            {/* Icon (if provided) */}
            {action.icon && !pending && (
                <span className="w-3 h-3 shrink-0" aria-hidden="true">
                    {/* Basic icon mapping - can be extended with proper icon library */}
                    {renderIcon(action.icon)}
                </span>
            )}
            
            {/* Loading spinner when pending */}
            {pending && (
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" aria-hidden="true" />
            )}
            
            {/* Button label */}
            <span>{pending ? 'Processing...' : action.label}</span>
        </button>
    )
}

/**
 * Basic icon rendering function. 
 * This can be extended to integrate with proper icon libraries like Lucide, Heroicons, etc.
 */
function renderIcon(iconName: string) {
    switch (iconName.toLowerCase()) {
        case 'check':
        case 'checkmark':
        case 'approve':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                </svg>
            )
        case 'x':
        case 'close':
        case 'reject':
        case 'cancel':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m18 6-12 12" />
                    <path d="m6 6 12 12" />
                </svg>
            )
        case 'refresh':
        case 'retry':
        case 'reload':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                </svg>
            )
        case 'edit':
        case 'pencil':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
            )
        case 'download':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7,10 12,15 17,10" />
                    <line x1="12" x2="12" y1="15" y2="3" />
                </svg>
            )
        case 'external':
        case 'link':
        case 'open':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6" />
                    <path d="M10 14 21 3" />
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
            )
        case 'play':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="6,3 20,12 6,21" />
                </svg>
            )
        default:
            // Default icon - a simple circle
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                </svg>
            )
    }
}