import { useEffect, useState, useCallback } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandGroup,
} from "@/components/ui/command"

interface Session {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

interface SessionSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSessionSelect: (sessionId: string) => void
  currentSessionId?: string | null
}

export function SessionSearch({ open, onOpenChange, onSessionSelect, currentSessionId }: SessionSearchProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch sessions when dialog opens
  useEffect(() => {
    if (!open) return
    
    const fetchSessions = async () => {
      try {
        setLoading(true)
        const res = await fetch('/sessions')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setSessions(data.sessions || [])
      } catch (err) {
        console.error('Failed to fetch sessions:', err)
        setSessions([])
      } finally {
        setLoading(false)
      }
    }

    fetchSessions()
  }, [open])

  const handleSelect = useCallback((sessionId: string) => {
    onSessionSelect(sessionId)
    onOpenChange(false)
  }, [onSessionSelect, onOpenChange])

  const formatDate = (iso: string) => {
    try {
      const date = new Date(iso)
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      
      if (days === 0) return 'Today'
      if (days === 1) return 'Yesterday'
      if (days < 7) return `${days} days ago`
      if (days < 30) return `${Math.floor(days / 7)} weeks ago`
      if (days < 365) return `${Math.floor(days / 30)} months ago`
      return `${Math.floor(days / 365)} years ago`
    } catch {
      return iso
    }
  }

  // Group sessions by date
  const groupedSessions = sessions.reduce((groups, session) => {
    const date = new Date(session.updated_at)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const lastWeek = new Date(today)
    lastWeek.setDate(lastWeek.getDate() - 7)
    
    let group = 'Older'
    if (date.toDateString() === today.toDateString()) {
      group = 'Today'
    } else if (date.toDateString() === yesterday.toDateString()) {
      group = 'Yesterday'
    } else if (date > lastWeek) {
      group = 'This Week'
    }
    
    if (!groups[group]) groups[group] = []
    groups[group].push(session)
    return groups
  }, {} as Record<string, Session[]>)

  const groupOrder = ['Today', 'Yesterday', 'This Week', 'Older']

  return (
    <CommandDialog 
      open={open} 
      onOpenChange={onOpenChange}
      title="Search Sessions"
      description="Search for a session by title or ID"
    >
      <CommandInput 
        placeholder="Search sessions..." 
        disabled={loading}
      />
      <CommandList>
        {loading ? (
          <CommandEmpty>Loading sessions...</CommandEmpty>
        ) : sessions.length === 0 ? (
          <CommandEmpty>No sessions found. Start a chat to create one.</CommandEmpty>
        ) : (
          <>
            <CommandEmpty>No sessions matching your search.</CommandEmpty>
            {groupOrder.map((group) => {
              const groupSessions = groupedSessions[group]
              if (!groupSessions || groupSessions.length === 0) return null
              
              return (
                <CommandGroup key={group} heading={group}>
                  {groupSessions.map((session) => (
                    <CommandItem
                      key={session.id}
                      value={`${session.title} ${session.id}`}
                      onSelect={() => handleSelect(session.id)}
                      className="flex items-center justify-between"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {session.title || 'Untitled Session'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {session.message_count} messages · {formatDate(session.updated_at)}
                        </span>
                      </div>
                      {currentSessionId === session.id && (
                        <span className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground">
                          Current
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}