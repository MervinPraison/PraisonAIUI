/**
 * Chat session rail: new chat, search, list, inline rename and delete.
 * Flat list grouped by whitespace; actions appear on hover/focus.
 */
import { useEffect, useRef, useState, type FC, type FormEvent, type KeyboardEvent } from 'react'
import { MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ChatSession } from './api'
import { Spinner } from './ui'

export interface SessionRailProps {
  sessions: ChatSession[]
  loading: boolean
  error?: string | null
  activeId: string | null
  runningIds: ReadonlySet<string>
  query: string
  onQuery: (q: string) => void
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** Mobile overlay: close button. */
  onClose?: () => void
  className?: string
}

function matches(s: ChatSession, q: string): boolean {
  return [s.id, s.title, s.agent, s.platform].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
}

function relativeTime(t?: number): string {
  if (!t) return ''
  const diff = Date.now() - t
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const RenameField: FC<{ initial: string; onSave: (title: string) => Promise<void>; onCancel: () => void }> = ({ initial, onSave, onCancel }) => {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const title = value.trim()
    if (!title || title === initial) return onCancel()
    setBusy(true)
    setError(null)
    try {
      await onSave(title)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
      setBusy(false)
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }
  return (
    <form onSubmit={submit} className="px-1 py-0.5">
      <input
        ref={ref}
        value={value}
        disabled={busy}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => !busy && void submit()}
        aria-label="Chat title"
        className="h-8 w-full rounded-md border border-ring bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {error && <p className="mt-1 px-1 text-xs text-destructive" role="alert">{error}</p>}
    </form>
  )
}

const SessionItem: FC<{
  s: ChatSession
  active: boolean
  running: boolean
  onSelect: () => void
  onRename: (title: string) => Promise<void>
  onDelete: () => Promise<void>
}> = ({ s, active, running, onSelect, onRename, onDelete }) => {
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm'>('view')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (mode === 'rename') {
    return (
      <li>
        <RenameField
          initial={s.untitled ? '' : s.title}
          onCancel={() => setMode('view')}
          onSave={async (title) => {
            await onRename(title)
            setMode('view')
          }}
        />
      </li>
    )
  }

  if (mode === 'confirm') {
    return (
      <li className="rounded-md bg-muted px-2 py-2" data-session-id={s.id}>
        <p className="truncate text-sm text-foreground">Delete “{s.title}”?</p>
        {error && <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>}
        <div className="mt-2 flex gap-1.5">
          <Button
            size="xs"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onDelete()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Delete failed')
                setBusy(false)
              }
            }}
          >
            {busy && <Spinner className="size-3" />}
            Delete
          </Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setMode('view')}>
            Cancel
          </Button>
        </div>
      </li>
    )
  }

  const meta = [s.agent, relativeTime(s.updatedAt)].filter(Boolean).join(' · ')
  return (
    <li className="group/item relative" data-session-id={s.id}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        title={s.title}
        className={cn(
          'flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active ? 'bg-muted text-foreground' : 'text-foreground/80 hover:bg-muted/60 hover:text-foreground',
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5 pr-12 text-sm">
          {running && <Spinner className="size-3 shrink-0 text-muted-foreground" />}
          <span className={cn('truncate', active && 'font-medium')}>{s.title}</span>
        </span>
        {meta && <span className="truncate pr-12 text-xs text-muted-foreground">{meta}</span>}
      </button>
      <div className="absolute top-1 right-1 hidden gap-0.5 group-focus-within/item:flex group-hover/item:flex">
        {!s.platform && (
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label={`Rename ${s.title}`} onClick={() => setMode('rename')}>
            <Pencil />
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${s.title}`} onClick={() => setMode('confirm')}>
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}

export const SessionRail: FC<SessionRailProps> = ({
  sessions, loading, error, activeId, runningIds, query, onQuery, onSelect, onNew, onRename, onDelete, onClose, className,
}) => {
  const q = query.trim().toLowerCase()
  const shown = q ? sessions.filter((s) => matches(s, q)) : sessions
  return (
    <nav aria-label="Chats" className={cn('flex h-full min-h-0 w-64 flex-col bg-background', className)}>
      <div className="flex h-12 shrink-0 items-center gap-1 px-3">
        <span className="flex-1 text-sm font-medium text-foreground">Chats</span>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={onNew} aria-label="New chat" title="New chat">
          <MessageSquarePlus />
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close chats">
            <X />
          </Button>
        )}
      </div>
      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-2 text-sm focus-within:border-ring/60 focus-within:ring-[3px] focus-within:ring-ring/15">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && !sessions.length ? (
          <div className="space-y-2 px-1 pt-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : error && !sessions.length ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{error}</p>
        ) : !shown.length ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{q ? 'No matching chats' : 'No chats yet'}</p>
        ) : (
          <ul className="space-y-0.5">
            {shown.map((s) => (
              <SessionItem
                key={s.id}
                s={s}
                active={s.id === activeId}
                running={runningIds.has(s.id)}
                onSelect={() => onSelect(s.id)}
                onRename={(title) => onRename(s.id, title)}
                onDelete={() => onDelete(s.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}
