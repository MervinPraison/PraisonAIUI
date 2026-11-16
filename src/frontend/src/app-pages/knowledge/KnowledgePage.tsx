/**
 * Knowledge (ProList.dc.html), the app shell's page for `knowledge` inside a
 * layout: a joined stat strip (the store's status as a chip in plain words),
 * a toolbar (search, "/" to focus; "Add knowledge" for text or files; Clear
 * all behind More), the entries table, a detail panel (facts, content,
 * Delete with a confirm) and, while the search box has words, the results
 * with their matches marked and the relevance the store reports. On a phone
 * the detail replaces the list, with a back control.
 *
 * Data (builtin.knowledge): GET /api/knowledge and /api/knowledge/status,
 * POST /api/knowledge and /api/knowledge/search, DELETE /api/knowledge[/{id}];
 * files go through POST /api/chat/attachments with index_to_knowledge, as
 * the legacy view did.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { BookOpen, ChevronDown, ChevronLeft, CircleAlert, FileText, LetterText, MoreHorizontal, Plus, SearchX, Trash, Upload } from 'lucide-react'
import { ListDetail, ListPagination, type ListColumn, type ListSort } from '@/components/page/ListDetail'
import { Facts, TemplateSearch } from '@/components/page/parts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { notify } from '@/sdk/notify'
import { fetchJson } from '@/sdk/services'
import { ago, fullTime, inLayoutOnly, Pill, useJson, useNow } from '../shared'
import { Modal, ModalActions } from '../Modal'
import { formatBytes, knowledgeRows, marked, relevance, snippet, sortRows, storeStatus, uploadError, type KnowledgeRow, type Segment, type StoreStatus } from './model'

const PAGE_SIZE = 20
const NARROW = '(max-width: 767px)'
const SEARCH_MODE: Record<string, string> = { vector: 'Semantic search', local: 'Keyword match', fallback: 'Keyword match (semantic search is unavailable)' }
const JOB_LABEL = { queued: 'Waiting', uploading: 'Indexing', done: 'Added', failed: 'Failed' } as const

type AddMode = 'text' | 'file'
interface Job { key: number; file: File; state: keyof typeof JOB_LABEL; error?: string }
interface Search { q: string; rows: KnowledgeRow[]; mode: string; warning: string | null; loading: boolean; error: string | null }
interface Confirm { title: string; text: string; action: string; run(): Promise<unknown>; done: string }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const subscribeNarrow = (cb: () => void) => {
  const m = window.matchMedia(NARROW)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false)

function Marked({ segments }: { segments: readonly Segment[] }) {
  return <>{segments.map((s, i) => (s.hit ? <mark key={i} className="rounded-xs bg-accent-soft text-foreground">{s.text}</mark> : <span key={i}>{s.text}</span>))}</>
}

function Relevance({ pct }: { pct: number }) {
  return (
    <span className="inline-flex items-center gap-2" title={`Relevance ${pct}%`}>
      <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></span>
      <span className="tabular-nums">{pct}%</span>
    </span>
  )
}

/** An icon tile, a title and one line: the empty, no-match and error states. */
function StateBlock({ icon, title, line, action, alert }: { icon: ReactNode; title: string; line: ReactNode; action?: ReactNode; alert?: boolean }) {
  return (
    <div role={alert ? 'alert' : undefined} className="flex w-full flex-col items-center gap-3 py-8 text-center">
      <span aria-hidden className={cn('flex size-10 items-center justify-center rounded-lg [&_svg]:size-5', alert ? 'bg-danger-soft text-destructive' : 'bg-muted text-muted-foreground')}>{icon}</span>
      <p className="m-0 text-base font-medium text-foreground">{title}</p>
      <p className="m-0 max-w-sm text-sm text-muted-foreground">{line}</p>
      {action}
    </div>
  )
}

function StatStrip({ total, files, status, loading }: { total: number; files: number; status: StoreStatus; loading: boolean }) {
  const cell = (label: string, value: ReactNode, words = false) => (
    <div className="flex min-h-[68px] min-w-0 flex-col gap-1 bg-background px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {loading ? <Skeleton className="h-5 w-16" /> : <span className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-foreground', words ? 'text-base font-medium' : 'text-xl leading-6 font-semibold tracking-[-0.02em] tabular-nums')}>{value}</span>}
    </div>
  )
  return (
    <section aria-label="Knowledge base summary" data-aiui-strip="" className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
      {cell('Entries', total.toLocaleString('en-US'))}
      {cell('Files', files.toLocaleString('en-US'))}
      {cell('Search', status.search, true)}
      {cell('Store', <><span title={status.note}>{status.store}</span><Pill tone={status.tone}>{status.label}</Pill></>, true)}
    </section>
  )
}

/** Files to the knowledge base one at a time, each with its own state. */
function useUploads(onAdded: () => void) {
  const [jobs, setJobs] = useState<Job[]>([])
  const next = useRef(0)
  const add = useCallback((files: Iterable<File>) => setJobs((js) => [...js, ...[...files].map((file) => ({ key: next.current++, file, state: 'queued' as const }))]), [])
  const busy = jobs.some((j) => j.state === 'uploading')
  const queued = jobs.find((j) => j.state === 'queued')
  useEffect(() => {
    if (busy || !queued) return
    const set = (patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.key === queued.key ? { ...j, ...patch } : j)))
    set({ state: 'uploading' })
    const body = new FormData()
    body.append('file', queued.file)
    body.append('index_to_knowledge', 'true')
    fetchJson('/api/chat/attachments', { method: 'POST', body }).then(
      (res) => {
        const error = uploadError(res)
        set(error ? { state: 'failed', error } : { state: 'done' })
        if (!error) onAdded()
      },
      (e: unknown) => set({ state: 'failed', error: message(e) }),
    )
  }, [busy, queued, onAdded])
  return { jobs, add, clear: () => setJobs((js) => js.filter((j) => j.state === 'uploading' || j.state === 'queued')) }
}

function KnowledgePage() {
  const list = useJson<unknown>('/api/knowledge', 30_000)
  const statusReq = useJson<{ total?: number; files?: number; backend?: string }>('/api/knowledge/status', 30_000)
  const status = useMemo(() => storeStatus(statusReq.data, statusReq.error), [statusReq.data, statusReq.error])
  const now = useNow()
  const narrow = useNarrow()
  const rows = useMemo(() => knowledgeRows(list.data), [list.data])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<Search | null>(null)
  const [searchTick, setSearchTick] = useState(0)
  const [sort, setSort] = useState<ListSort>({ key: 'added', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState<AddMode | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const { reload: reloadList } = list
  const { reload: reloadStatus } = statusReq
  const refresh = useCallback(() => {
    reloadList()
    reloadStatus()
    setSearchTick((t) => t + 1)
  }, [reloadList, reloadStatus])
  const uploads = useUploads(refresh)

  // The search box asks the store (semantic or keyword, whichever it has) once typing pauses.
  useEffect(() => {
    const q = query.trim()
    if (!q) return setSearch(null)
    setSearch((s) => ({ q, rows: s?.rows ?? [], mode: s?.mode ?? '', warning: s?.warning ?? null, loading: true, error: null }))
    let live = true
    const id = window.setTimeout(() => {
      fetchJson<{ search_mode?: string; warning?: string | null }>('/api/knowledge/search', { body: { query: q, limit: 50 } }).then(
        (d) => live && setSearch({ q, rows: knowledgeRows(d), mode: d?.search_mode ?? '', warning: d?.warning ?? null, loading: false, error: null }),
        (e: unknown) => live && setSearch({ q, rows: [], mode: '', warning: null, loading: false, error: message(e) }),
      )
    }, 300)
    return () => {
      live = false
      window.clearTimeout(id)
    }
  }, [query, searchTick])

  // "/" focuses the search (not while typing elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return
      e.preventDefault()
      searchRef.current?.querySelector('input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  const shown = search ? search.rows : sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const current = shown.find((r) => r.id === selected) ?? rows.find((r) => r.id === selected) ?? null
  const scored = !!search?.rows.some((r) => relevance(r.score) != null)
  const skeleton = list.loading && !list.data

  const run = async (c: Confirm) => {
    setNotice(null)
    try {
      await c.run()
      refresh()
      void notify(c.done, { type: 'success' })
    } catch (e) {
      setNotice(`${c.action} failed: ${message(e)}`)
    }
  }
  const askDelete = (row: KnowledgeRow) =>
    setConfirm({
      title: 'Delete this knowledge?',
      text: `“${row.name}” is removed from the knowledge base, and agents stop finding it. This cannot be undone.`,
      action: 'Delete',
      done: 'Knowledge deleted',
      run: () => fetchJson(`/api/knowledge/${encodeURIComponent(row.id)}`, { method: 'DELETE' }).then(() => setSelected((s) => (s === row.id ? null : s))),
    })
  const askClear = () =>
    setConfirm({
      title: 'Clear the knowledge base?',
      text: `All ${rows.length} entries are removed, and agents stop finding them. This cannot be undone.`,
      action: 'Clear all',
      done: 'Knowledge base cleared',
      run: () => fetchJson('/api/knowledge', { method: 'DELETE' }).then(() => setSelected(null)),
    })
  const toggleSort = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'type' ? 'asc' : 'desc' }))

  const time = (r: KnowledgeRow) =>
    Number.isFinite(r.added) ? (
      <time className="whitespace-nowrap text-muted-foreground" dateTime={new Date(r.added).toISOString()} title={fullTime(r.added)}>{ago(r.added, now)}</time>
    ) : (
      <span className="text-tier-3">—</span>
    )
  const nameCell = (r: KnowledgeRow) => (
    <span className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground [&_svg]:size-3.5">{r.filename ? <FileText /> : <LetterText />}</span>
      <span className="flex min-w-0 flex-col">
        <span className={cn('block truncate font-medium text-foreground', narrow ? 'max-w-[12.5rem]' : 'max-w-[28rem]')}>{r.name}</span>
        {narrow && !search && <span className="truncate text-xs font-normal text-tier-3">{`${r.type} · ${formatBytes(r.bytes)}`}</span>}
        {narrow && search && (
          <span className="line-clamp-2 text-xs font-normal whitespace-normal text-muted-foreground"><Marked segments={snippet(r.text, search.q, 100)} /></span>
        )}
      </span>
    </span>
  )
  const matchCell = (r: KnowledgeRow) => (
    <span className="line-clamp-2 block max-w-[36rem] min-w-[16rem] py-1.5 whitespace-normal"><Marked segments={snippet(r.text, search?.q ?? '')} /></span>
  )
  const wide = <T,>(cols: T[]) => (narrow ? [] : cols)
  const columns: ListColumn<KnowledgeRow>[] = skeleton
    ? (narrow ? ['Name', 'Added'] : ['Name', 'Type', 'Size', 'Added']).map((label, i) => ({ key: label.toLowerCase(), label, align: i > 0 && label !== 'Type' ? 'end' : undefined, render: () => <Skeleton className={cn('inline-block h-4 align-middle', i === 0 ? 'w-40' : 'w-14')} /> }))
    : search
      ? [
          { key: 'name', label: 'Name', render: nameCell },
          ...wide([{ key: 'match', label: 'Match', render: matchCell }]),
          ...(scored ? [{ key: 'relevance', label: 'Relevance', align: 'end' as const, render: (r: KnowledgeRow) => (relevance(r.score) == null ? '—' : <Relevance pct={relevance(r.score)!} />) }] : []),
          ...wide([{ key: 'added', label: 'Added', align: 'end' as const, render: time }]),
        ]
      : [
          { key: 'name', label: 'Name', render: nameCell },
          ...wide([{ key: 'type', label: 'Type' }, { key: 'size', label: 'Size', align: 'end' as const, render: (r: KnowledgeRow) => formatBytes(r.bytes) }]),
          { key: 'added', label: 'Added', align: 'end', render: time },
        ]

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm"><Plus aria-hidden />Add knowledge<ChevronDown aria-hidden /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setAdding('text')}><LetterText aria-hidden />Add text</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAdding('file')}><Upload aria-hidden />Upload files</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const toolbar = (
    <>
      <div ref={searchRef} className="min-w-[12rem] flex-1 basis-full sm:max-w-xs sm:basis-auto">
        <TemplateSearch label="Search knowledge" value={query} onChange={setQuery} placeholder="Search knowledge" shortcut="/" />
      </div>
      <span className="flex-1" />
      {addMenu}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More knowledge actions" className="text-muted-foreground"><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={rows.length === 0} className="text-destructive focus:text-destructive [&_svg]:!text-destructive" onSelect={askClear}><Trash aria-hidden />Clear all knowledge</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )

  const outline = (label: string, onClick: () => void) => <Button size="sm" variant="outline" onClick={onClick}>{label}</Button>
  const empty = search ? (
    search.error ? (
      <StateBlock alert icon={<CircleAlert />} title="Search failed" line={search.error} action={outline('Try again', () => setSearchTick((t) => t + 1))} />
    ) : search.loading ? (
      <div className="flex w-full items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner size="sm" tone="muted" /> Searching the knowledge base
      </div>
    ) : (
      <StateBlock icon={<SearchX />} title={`No knowledge matches “${search.q}”`} line="Try other words, or add what your agents should know about it." action={outline('Clear search', () => setQuery(''))} />
    )
  ) : list.error && !list.data ? (
    <StateBlock alert icon={<CircleAlert />} title="Knowledge could not be loaded" line={list.error} action={outline('Retry', refresh)} />
  ) : (
    <StateBlock icon={<BookOpen />} title="No knowledge yet" line="Add notes or files, and your agents can search them when they answer." action={addMenu} />
  )
  const footer = search ? (
    search.rows.length > 0 && (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-xs text-tier-3" aria-live="polite">
        <span>{`${search.rows.length} ${search.rows.length === 1 ? 'result' : 'results'} for “${search.q}”${search.mode ? ` · ${SEARCH_MODE[search.mode] ?? search.mode}` : ''}`}</span>
        {search.loading && <Spinner size="sm" tone="muted" />}
        {search.warning && <span className="text-warning">{search.warning}</span>}
        <Button variant="link" size="xs" onClick={() => setQuery('')}>Clear search</Button>
      </div>
    )
  ) : rows.length > 0 ? (
    <ListPagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} hints={!narrow} />
  ) : undefined

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-aiui-app-page="knowledge" data-drill={narrow && current ? '' : undefined}>
      <StatStrip total={statusReq.data?.total ?? rows.length} files={statusReq.data?.files ?? 0} status={status} loading={statusReq.loading} />
      {[...status.warnings.map((w) => ['warn', w]), ...(notice ? [['bad', notice]] : [])].map(([tone, text]) => (
        <p key={text} role={tone === 'bad' ? 'alert' : undefined} className={cn('m-0 mt-3 rounded-md px-3 py-2 text-sm', tone === 'bad' ? 'bg-danger-soft text-destructive' : 'bg-warning-soft text-warning')}>{text}</p>
      ))}
      <ListDetail<KnowledgeRow>
        label="Knowledge"
        columns={columns}
        rows={skeleton ? Array.from({ length: 6 }, (_, i) => ({ id: `skeleton-${i}` }) as KnowledgeRow) : shown}
        selectedId={selected}
        onSelect={(id) => !skeleton && setSelected(id)}
        {...(search || skeleton ? {} : { sort, onSort: toggleSort })}
        toolbar={toolbar}
        detailTitle={current?.name}
        detail={current ? <KnowledgeDetail row={current} now={now} query={search?.q ?? ''} narrow={narrow} onBack={() => setSelected(null)} onDelete={() => askDelete(current)} /> : undefined}
        empty={empty}
        footer={skeleton ? undefined : footer}
      />
      <AddDialog
        mode={adding}
        onMode={setAdding}
        onClose={() => { setAdding(null); uploads.clear() }}
        onAdded={(id) => { refresh(); if (id) setSelected(id); void notify('Knowledge added', { type: 'success' }) }}
        jobs={uploads.jobs}
        onFiles={uploads.add}
        allFiles={/sdk/i.test(statusReq.data?.backend ?? '')}
      />
      <Modal open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ''} description={confirm?.text}>
        <ModalActions>
          <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { if (confirm) void run(confirm); setConfirm(null) }}>{confirm?.action}</Button>
        </ModalActions>
      </Modal>
    </div>
  )
}

function KnowledgeDetail({ row, now, query, narrow, onBack, onDelete }: { row: KnowledgeRow; now: number; query: string; narrow: boolean; onBack(): void; onDelete(): void }) {
  const pct = relevance(row.score)
  const id = <code className="font-mono text-xs font-normal">{row.id}</code>
  return (
    <div className="flex flex-col gap-5">
      {narrow && <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}><ChevronLeft aria-hidden />All knowledge</Button>}
      <Facts
        items={[
          { label: 'Type', value: row.type },
          { label: 'Size', value: `${formatBytes(row.bytes)} · ${row.words.toLocaleString('en-US')} words` },
          { label: 'Added', value: Number.isFinite(row.added) ? <span title={fullTime(row.added)}>{ago(row.added, now)}</span> : '—' },
          { label: 'Source', value: row.filename ? `Upload: ${row.filename}` : row.source },
          // The ID fills the sixth cell beside Relevance; otherwise it is a line under the actions.
          ...(pct != null ? [{ label: 'Relevance', value: `${pct}%` }, { label: 'ID', value: id }] : []),
        ]}
      />
      <section aria-label="Content" className="flex min-w-0 flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold text-foreground">Content</h3>
        <div className="max-h-96 overflow-auto rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">{row.text ? <Marked segments={marked(row.text, query)} /> : <span className="text-tier-3">No text.</span>}</div>
      </section>
      <Button variant="destructive" size="sm" className="self-start" onClick={onDelete}><Trash aria-hidden />Delete</Button>
      {pct == null && <p className="m-0 text-xs text-tier-3">ID {id}</p>}
    </div>
  )
}

function AddDialog({ mode, onMode, onClose, onAdded, jobs, onFiles, allFiles }: { mode: AddMode | null; onMode(mode: AddMode): void; onClose(): void; onAdded(id?: string): void; jobs: readonly Job[]; onFiles(files: Iterable<File>): void; allFiles: boolean }) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  useEffect(() => {
    if (mode) return
    setTitle('')
    setText('')
    setError(null)
  }, [mode])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const entry = await fetchJson<{ id?: string }>('/api/knowledge', { body: { text: text.trim(), metadata: { source: 'manual', ...(title.trim() ? { title: title.trim() } : {}) } } })
      onAdded(entry?.id)
      onClose()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const finished = jobs.filter((j) => j.state === 'done' || j.state === 'failed').length
  const working = jobs.some((j) => j.state === 'queued' || j.state === 'uploading')
  const label = 'flex flex-col gap-1.5 text-sm font-medium text-foreground'
  return (
    <Modal open={!!mode} onOpenChange={(o) => !o && onClose()} title="Add knowledge" description="Agents search the knowledge base when they answer." onOpenAutoFocus={(e) => { e.preventDefault(); field.current?.focus() }}>
      <div role="group" aria-label="What to add" className="flex gap-1">
        {(['text', 'file'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)} className={cn('h-8 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', mode === m ? 'border-transparent bg-accent-soft text-link' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')}>
            {m === 'text' ? 'Text' : 'Files'}
          </button>
        ))}
      </div>
      {mode === 'text' ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) void save() }}>
          <label className={label}><span>Title <span className="font-normal text-tier-3">(optional)</span></span><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Refund policy" /></label>
          <label className={label}>Text<Textarea ref={field} value={text} onChange={(e) => setText(e.target.value)} rows={8} className="max-h-[50vh] font-normal" placeholder="Paste or type what your agents should know" /></label>
          {error && <p role="alert" className="m-0 text-sm text-destructive">{error}</p>}
          <ModalActions>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!text.trim() || busy}>{busy && <Spinner size="sm" />}Add knowledge</Button>
          </ModalActions>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <label
            data-over={over || undefined}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-input px-4 py-8 text-center focus-within:ring-2 focus-within:ring-ring hover:bg-muted data-[over]:border-primary data-[over]:bg-accent-soft"
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files) }}
          >
            <span aria-hidden className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5"><Upload /></span>
            <span className="text-sm font-medium text-foreground">Drop files here or <span className="text-link underline underline-offset-2">choose files</span></span>
            <span className="text-xs text-tier-3">{allFiles ? 'Text, Markdown, CSV, JSON, PDF and Word files.' : 'Text, Markdown and CSV files. PDF and Word files need the vector store.'}</span>
            <input ref={field} type="file" multiple accept=".txt,.md,.markdown,.csv,.json,.pdf,.doc,.docx,.html" aria-label="Choose files" className="sr-only" onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = '' }} />
          </label>
          {jobs.length > 0 && (
            <div className="flex flex-col gap-3" aria-live="polite">
              <div className="flex items-center gap-3">
                <Progress value={(finished / jobs.length) * 100} aria-label="Upload progress" className="flex-1" />
                <span className="text-xs text-tier-3 tabular-nums">{`${finished} of ${jobs.length}`}</span>
              </div>
              <ul className="m-0 flex max-h-48 list-none flex-col gap-2 overflow-auto p-0">
                {jobs.map((j) => (
                  <li key={j.key} className="flex min-w-0 items-start gap-2 text-sm">
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">{j.state === 'uploading' ? <Spinner size="sm" tone="muted" /> : j.state === 'failed' ? <CircleAlert className="text-destructive" aria-hidden /> : <FileText aria-hidden />}</span>
                    <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-foreground">{j.file.name}</span>{j.error && <span className="text-xs text-destructive">{j.error}</span>}</span>
                    <span className={cn('shrink-0 text-xs', j.state === 'done' ? 'text-success' : j.state === 'failed' ? 'text-destructive' : 'text-tier-3')}>{JOB_LABEL[j.state]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ModalActions>
            <Button variant="outline" onClick={onClose}>{jobs.length && !working ? 'Done' : 'Close'}</Button>
          </ModalActions>
        </div>
      )}
    </Modal>
  )
}

export default inLayoutOnly(KnowledgePage)
