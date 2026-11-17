/**
 * The sidebar's chats (meta.chat.sessions 'frame'): two-line rows, the
 * title over "3 artifacts · now" ("Working…" while a run goes), the open chat raised on
 * the card colour; a search toggle in the heading. Over the `sessions` feed
 * (the kit's useSessions), so it renders nothing while builtin.chat is off.
 */
import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSessions, type KitSize } from '@/app-layouts/kit'
import { cn } from '@/lib/utils'
import { chatRowMeta, relativeTime } from './format'

// The rows' times, to the minute, as of the last render (no timer of its own).
const noSubscribe = () => () => {}
const readMinute = () => Math.floor(Date.now() / 60_000)

export interface ChatListProps {
  size?: KitSize
  /** Show at most this many (the feed's order: newest first). */
  limit?: number
  /** After a chat is opened (the frame shows the chat page, a sheet closes). */
  onOpen?(sessionId: string): void
  className?: string
  /** Artifacts per chat (the artifacts index), for the rows' second line. */
  counts?: ReadonlyMap<string, number>
  /** For tests: the clock. */
  now?: number
}

export function ChatList({ size = 'default', limit = 30, onOpen, className, counts, now }: ChatListProps) {
  const sessions = useSessions()
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const all = sessions?.state.sessions
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = q ? (all ?? []).filter((s) => s.title.toLowerCase().includes(q)) : (all ?? [])
    return hits.slice(0, limit)
  }, [all, query, limit])
  const minute = useSyncExternalStore(noSubscribe, readMinute, readMinute)
  const clock = now ?? minute * 60_000
  if (!sessions) return null
  const { feed, state } = sessions
  const touch = size === 'touch'

  const toggleSearch = () => {
    if (searching) setQuery('')
    setSearching(!searching)
    if (!searching) queueMicrotask(() => input.current?.focus())
  }

  return (
    <section aria-labelledby={labelId} className={cn('flex min-h-0 flex-col gap-1', className)} data-cc-chats="">
      <div className="flex items-center pr-1 pl-2.5">
        <h2 id={labelId} className={cn('m-0 font-semibold text-muted-foreground', touch ? 'text-sm' : 'text-[13px]')}>
          Chats
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className={cn('ml-auto text-muted-foreground', touch ? 'size-11' : 'size-7')}
          aria-label={searching ? 'Close chat search' : 'Search chats'}
          aria-expanded={searching}
          onClick={toggleSearch}
        >
          <Search />
        </Button>
      </div>
      {searching && (
        <Input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') toggleSearch()
          }}
          placeholder="Search chats"
          aria-label="Search chats"
          className={cn('bg-background', touch ? 'h-11 text-base' : 'h-8')}
        />
      )}
      {state.loading && state.sessions.length === 0 ? (
        <div role="status" aria-label="Loading chats" className="flex flex-col gap-2 px-2.5 py-1">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : shown.length === 0 ? (
        <p className="m-0 px-2.5 text-[13px] text-muted-foreground">{query ? 'No chats match.' : 'No chats yet.'}</p>
      ) : (
        <ul className="m-0 flex min-h-0 list-none flex-col gap-px overflow-y-auto p-0">
          {shown.map((s) => {
            const active = s.id === state.activeId
            const running = state.runningIds.has(s.id)
            const meta = running ? 'Working…' : chatRowMeta(counts?.get(s.id), relativeTime(s.updatedAt, clock))
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  data-aiui-session={s.id}
                  className={cn(
                    'flex w-full min-w-0 flex-col rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors',
                    'hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring',
                    touch && 'min-h-11',
                    // The open chat: the accent fill and a 2px primary edge, visible on the grey sidebar in light mode too.
                    active ? 'bg-sidebar-accent text-foreground shadow-[inset_2px_0_0_var(--primary)]' : 'text-sidebar-foreground',
                  )}
                  onClick={() => {
                    feed.select(s.id)
                    onOpen?.(s.id)
                  }}
                >
                  <span className={cn('w-full truncate', touch ? 'text-[15px]' : 'text-sm', active && 'font-semibold')}>{s.title}</span>
                  {meta && (
                    <span className={cn('w-full truncate text-xs tabular-nums', running ? 'font-medium text-warning' : 'text-muted-foreground')} data-cc-chat-meta="">
                      {meta}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
