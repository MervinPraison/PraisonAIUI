/**
 * The chat list a frame draws (meta.chat.sessions 'frame'), over the
 * `sessions` feed builtin.chat provides. Renders nothing while no provider
 * is on (the chat built-in disabled), so a frame never crashes without it.
 */
import { useMemo, useState } from 'react'
import { CirclePause, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { relativeTime } from './format'
import { NavSection } from './NavList'
import { navRowClass, type KitSize } from './rows'
import { useSessions } from './useSessions'

export interface SessionListProps {
  title?: string
  /** Show at most this many (the newest first, as the feed orders them). */
  limit?: number
  /** A search box over titles. */
  search?: boolean
  size?: KitSize
  /** After a session is opened (the frame goes to its chat page, a sheet closes). */
  onOpen?(sessionId: string): void
  /** Each row ends with when the chat was last active (Now, 2h, Yesterday…). */
  showTime?: boolean
  /** Clock for `showTime` (tests). Default Date.now() at render. */
  now?: number
  /** Sessions with an approval waiting: a "Waiting" label instead of the time. */
  waitingIds?: ReadonlySet<string>
  className?: string
}

export function SessionList({
  title = 'Recent chats',
  limit,
  search = false,
  size = 'default',
  onOpen,
  showTime = false,
  now,
  waitingIds,
  className,
}: SessionListProps) {
  const sessions = useSessions()
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const all = sessions?.state.sessions ?? []
    const q = query.trim().toLowerCase()
    const hits = q ? all.filter((s) => s.title.toLowerCase().includes(q)) : all
    return limit ? hits.slice(0, limit) : hits
  }, [sessions?.state.sessions, query, limit])
  if (!sessions) return null
  const { feed, state } = sessions
  const touch = size === 'touch'
  const clock = now ?? Date.now()

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)} data-aiui-session-list="">
      <NavSection title={title} size={size} className="flex-1">
        {search && (
          <div className="relative">
            <Search aria-hidden="true" className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-tier-3', touch ? 'left-3 size-4' : 'left-2.5 size-3.5')} />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className={cn('bg-background', touch ? 'h-11 pl-9 text-base' : 'h-8 pl-8')}
            />
          </div>
        )}
        {state.loading && state.sessions.length === 0 ? (
          <div role="status" aria-label="Loading chats" className="flex flex-col gap-1.5 px-2 py-1">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : shown.length === 0 ? (
          <p className="m-0 px-2 text-xs text-muted-foreground">{query ? 'No chats match.' : 'No chats yet.'}</p>
        ) : (
          <ul className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-y-auto p-0">
            {shown.map((s) => {
              const active = s.id === state.activeId
              const running = state.runningIds.has(s.id)
              const waiting = !!waitingIds?.has(s.id)
              const time = showTime && !running && !waiting ? relativeTime(s.updatedAt, clock) : ''
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    data-aiui-session={s.id}
                    className={navRowClass(size, active)}
                    onClick={() => {
                      feed.select(s.id)
                      onOpen?.(s.id)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {waiting ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-warning">
                        <CirclePause aria-hidden="true" className="size-3.5" />
                        Waiting
                      </span>
                    ) : running ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-warning">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                        Running
                      </span>
                    ) : time ? (
                      <span className="shrink-0 text-xs text-tier-3 tabular-nums">{time}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </NavSection>
    </div>
  )
}
