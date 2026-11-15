/**
 * Sessions (ProList.dc.html), the app shell's page for `sessions` inside a
 * layout: a toolbar (search, "/" to focus; status chips; agent filter), a
 * sortable table (Title, Agent, Messages, Tokens, Updated, Status), a detail
 * panel for the selected row (facts, first and last message, Open in chat),
 * and a row menu with labelled actions (Open, Rename, Compact, Reset,
 * Delete). Delete asks first. Built on the list/detail page template.
 *
 * Data: GET /api/sessions (sessions_ext), the preview for the selected row,
 * and the layout's sessions feed when there is one (running sessions, and
 * rename/remove through the same store the frame's list reads).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, ExternalLink, MessageSquarePlus, MoreHorizontal, PenLine, RotateCcw, Trash2 } from 'lucide-react'
import { ListDetail, ListPagination, type ListColumn, type ListSort } from '@/components/page/ListDetail'
import { Facts, TemplateSearch } from '@/components/page/parts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useLayoutData } from '@/sdk/layouts'
import { fetchJson, navigate } from '@/sdk/services'
import { ago, fullTime, inLayoutOnly, Pill, useJson, useNow, type AppPageProps } from '../shared'
import { sessionRows, sortRows, filterRows, type SessionRow, type StatusFilter } from './model'

const PAGE_SIZE = 20
const ALL_AGENTS = '__all__'

const STATUS_CHIPS: readonly { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'today', label: 'Today' },
  { id: 'older', label: 'Older' },
]

interface Preview {
  total_messages?: number
  estimated_tokens?: number
  first_message?: { role?: string; preview?: string } | null
  last_message?: { role?: string; preview?: string } | null
}

/** Open a session in the chat page (the chat listens for aiui:session-select). */
function openInChat(id: string) {
  navigate('chat')
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('aiui:session-select', { detail: { sessionId: id } })), 0)
}

function newChat() {
  navigate('chat')
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('aiui:session-select', { detail: { sessionId: null } })), 0)
}

function Monogram({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-2xs font-semibold text-link">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function SessionsPage(_: AppPageProps) {
  const list = useJson<{ sessions?: unknown[] } | unknown[]>('/api/sessions', 15_000)
  const feed = useLayoutData('sessions')
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (!feed) return
    const sync = () => setRunning(feed.get().runningIds)
    sync()
    return feed.subscribe(sync)
  }, [feed])
  const now = useNow()

  const rows = useMemo(() => sessionRows(list.data, running), [list.data, running])
  const agents = useMemo(() => [...new Set(rows.map((r) => r.agent).filter((a): a is string => !!a))].sort(), [rows])

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [agent, setAgent] = useState(ALL_AGENTS)
  const [sort, setSort] = useState<ListSort>({ key: 'updated', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<SessionRow | null>(null)
  const [deleting, setDeleting] = useState<SessionRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(
    () => sortRows(filterRows(rows, { query, status, agent: agent === ALL_AGENTS ? null : agent, now }), sort),
    [rows, query, status, agent, now, sort],
  )
  const pageRows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  useEffect(() => setPage(1), [query, status, agent])

  // "/" focuses the search (not while typing elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      searchRef.current?.querySelector('input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const act = useCallback(
    async (what: string, fn: () => Promise<unknown>) => {
      setNotice(null)
      try {
        await fn()
        list.reload()
      } catch (e) {
        setNotice(`${what} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [list],
  )

  const remove = (row: SessionRow) =>
    act('Delete', async () => {
      if (feed) await feed.remove(row.id)
      else await fetchJson(`/sessions/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (selected === row.id) setSelected(null)
    })
  const rename = (row: SessionRow, title: string) =>
    act('Rename', async () => {
      if (!feed) throw new Error('renaming needs the chat')
      await feed.rename(row.id, title)
    })
  const compact = (row: SessionRow) => act('Compact', () => fetchJson(`/api/sessions/${encodeURIComponent(row.id)}/compact`, { method: 'POST' }))
  const reset = (row: SessionRow) => act('Reset', () => fetchJson(`/api/sessions/${encodeURIComponent(row.id)}/reset`, { method: 'POST' }))

  const toggleSort = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'title' || key === 'agent' ? 'asc' : 'desc' }))

  const rowMenu = (row: SessionRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="aiui-row-menu text-muted-foreground"
          aria-label={`Actions for ${row.title}`}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => openInChat(row.id)}>
          <ExternalLink aria-hidden />
          Open in chat
        </DropdownMenuItem>
        {feed && (
          <DropdownMenuItem onSelect={() => setRenaming(row)}>
            <PenLine aria-hidden />
            Rename
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void compact(row)}>
          <Archive aria-hidden />
          Compact history
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void reset(row)}>
          <RotateCcw aria-hidden />
          Reset
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive [&_svg]:!text-destructive" onSelect={() => setDeleting(row)}>
          <Trash2 aria-hidden />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const columns: ListColumn<SessionRow>[] = [
    {
      key: 'title',
      label: 'Title',
      render: (r) => <span className="block max-w-[28rem] truncate font-medium text-foreground">{r.title}</span>,
    },
    {
      key: 'agent',
      label: 'Agent',
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <Monogram name={r.agent ?? 'Default'} />
          <span className="truncate text-muted-foreground">{r.agent ?? 'Default agent'}</span>
        </span>
      ),
    },
    { key: 'messages', label: 'Messages', align: 'end', render: (r) => <span className="tabular-nums">{r.messages}</span> },
    { key: 'tokens', label: 'Tokens', align: 'end', render: (r) => <span className="tabular-nums">{r.tokens ? r.tokens.toLocaleString('en-US') : '—'}</span> },
    {
      key: 'updated',
      label: 'Updated',
      align: 'end',
      render: (r) => (
        <time className="whitespace-nowrap text-muted-foreground" dateTime={Number.isFinite(r.updated) ? new Date(r.updated).toISOString() : undefined} title={fullTime(r.updated)}>
          {ago(r.updated, now)}
        </time>
      ),
    },
    { key: 'status', label: 'Status', render: (r) => (r.running ? <Pill tone="ok">Running</Pill> : <Pill tone="idle">Idle</Pill>) },
    { key: 'actions', label: '', align: 'end', render: rowMenu },
  ]

  const current = rows.find((r) => r.id === selected) ?? null
  const toolbar = (
    <>
      <div ref={searchRef} className="min-w-[12rem] flex-1 sm:max-w-xs">
        <TemplateSearch label="Search sessions" value={query} onChange={setQuery} placeholder="Search sessions  /" />
      </div>
      <div role="group" aria-label="Status" className="flex items-center gap-1">
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={status === c.id}
            onClick={() => setStatus(c.id)}
            className={cn(
              'h-8 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
              status === c.id ? 'border-transparent bg-accent-soft text-link' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {agents.length > 0 && (
        <Select value={agent} onValueChange={setAgent}>
          <SelectTrigger size="sm" aria-label="Agent" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_AGENTS}>All agents</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <span className="flex-1" />
      <Button size="sm" onClick={newChat}>
        <MessageSquarePlus aria-hidden />
        New chat
      </Button>
    </>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-aiui-app-page="sessions">
      {notice && (
        <p role="alert" className="mx-4 mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-destructive sm:mx-6">
          {notice}
        </p>
      )}
      <ListDetail<SessionRow>
        label="Sessions"
        columns={columns}
        rows={pageRows}
        selectedId={selected}
        onSelect={setSelected}
        onOpen={openInChat}
        sort={sort}
        onSort={(k) => (k === 'actions' ? undefined : toggleSort(k))}
        toolbar={toolbar}
        detailTitle={current?.title}
        detail={current ? <SessionDetail row={current} now={now} /> : undefined}
        empty={
          list.loading ? (
            <p className="m-0 text-sm text-muted-foreground">Loading sessions…</p>
          ) : rows.length === 0 ? (
            <EmptySessions />
          ) : (
            <p className="m-0 text-sm text-muted-foreground">No session matches these filters.</p>
          )
        }
        footer={shown.length > 0 ? <ListPagination page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} /> : undefined}
      />
      <RenameDialog row={renaming} onClose={() => setRenaming(null)} onSave={(r, t) => void rename(r, t)} />
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              “{deleting?.title}” and its {deleting?.messages ?? 0} messages are removed for good. Compact its history instead to keep a summary.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (deleting) void compact(deleting)
                setDeleting(null)
              }}
            >
              Compact instead
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) void remove(deleting)
                setDeleting(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmptySessions() {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="m-0 text-base font-medium text-foreground">No sessions yet: start a chat</p>
      <p className="m-0 text-sm text-muted-foreground">Every conversation with an agent is kept here.</p>
      <Button size="sm" onClick={newChat}>
        <MessageSquarePlus aria-hidden />
        New chat
      </Button>
    </div>
  )
}

function SessionDetail({ row, now }: { row: SessionRow; now: number }) {
  const preview = useJson<Preview>(`/api/sessions/${encodeURIComponent(row.id)}/preview`)
  const p = preview.data
  const message = (label: string, m?: { role?: string; preview?: string } | null): ReactNode =>
    m?.preview ? (
      <div className="flex flex-col gap-1">
        <span className="text-2xs font-medium tracking-wide text-tier-3 uppercase">
          {label} · {m.role === 'user' ? 'You' : 'Agent'}
        </span>
        <p className="m-0 rounded-md bg-muted px-3 py-2 text-sm text-foreground">{m.preview}</p>
      </div>
    ) : null
  return (
    <div className="flex flex-col gap-4">
      <Facts
        items={[
          { label: 'Messages', value: p?.total_messages ?? row.messages },
          { label: 'Tokens', value: (row.tokens || p?.estimated_tokens || 0).toLocaleString('en-US') },
          { label: 'Agent', value: row.agent ?? 'Default agent' },
          { label: 'Updated', value: <span title={fullTime(row.updated)}>{ago(row.updated, now)}</span> },
          { label: 'Created', value: <span title={fullTime(row.created)}>{ago(row.created, now)}</span> },
          { label: 'Status', value: row.running ? 'Running' : 'Idle' },
        ]}
      />
      {preview.loading ? <p className="m-0 text-sm text-muted-foreground">Loading the messages…</p> : null}
      {message('First message', p?.first_message)}
      {message('Last message', p?.last_message)}
      <Button onClick={() => openInChat(row.id)} className="self-start">
        <ExternalLink aria-hidden />
        Open in chat
      </Button>
    </div>
  )
}

function RenameDialog({ row, onClose, onSave }: { row: SessionRow | null; onClose(): void; onSave(row: SessionRow, title: string): void }) {
  const [title, setTitle] = useState('')
  useEffect(() => setTitle(row?.title ?? ''), [row])
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (row && title.trim()) onSave(row, title.trim())
            onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>The new name shows in the chat list and here.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Session name" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default inLayoutOnly(SessionsPage)
