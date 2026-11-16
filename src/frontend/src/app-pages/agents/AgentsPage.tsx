/**
 * Agents (ProList.dc.html), the app shell's page for `agents` inside a
 * layout: a toolbar (search, "/" to focus; a model filter; one "New agent"
 * button), a sortable table (monogram, name, description, model, tools,
 * updated, status), a detail panel for the selected agent (every field,
 * Edit, Duplicate, Training history, Delete with a confirmation) and the
 * create/edit form in that same panel; Enter on a row edits it. On a phone
 * the panel replaces the list (app-pages.css, data-drill-in) and its close
 * button goes back.
 *
 * Data: the agents_crud feature (GET/POST /api/agents/definitions,
 * PUT/DELETE …/{id}, POST /api/agents/duplicate/{id}, GET /api/agents/models).
 * Agents the app registers in code (`source: gateway`) cannot be updated or
 * deleted there, so they get Duplicate only.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Bot, CopyPlus, FlaskConical, PenLine, Plus, RotateCw, SearchX, Trash, TriangleAlert } from 'lucide-react'
import { ListDetail, ListPagination, type ListColumn, type ListSort } from '@/components/page/ListDetail'
import { Facts, TemplateSearch } from '@/components/page/parts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { notify } from '@/sdk/notify'
import { fetchJson, navigate, useManifest } from '@/sdk/services'
import { ago, fullTime, inLayoutOnly, Pill, useJson, useNow } from '../shared'
import { Modal, ModalActions } from '../Modal'
import {
  agentRows, defaultModel, draftError, draftOf, filterAgents, modelOptions, monogram, payloadOf, sortAgents, statusLabel, summaryOf,
  type AgentDraft, type AgentRow,
} from './model'

const API = '/api/agents/definitions'
const PAGE_SIZE = 20
const ALL = '__all__'
/** The panel's id while it holds the create form (no row has it). */
const NEW = '__new__'
const PHONE = '(max-width: 639px)'

const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia(PHONE)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false)
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const LABEL = 'text-2xs font-medium tracking-wide text-tier-3 uppercase'

function Monogram({ name, large }: { name: string; large?: boolean }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center bg-accent-soft font-semibold text-link', large ? 'size-10 rounded-lg text-sm' : 'size-6 rounded-sm text-2xs')}>
      {monogram(name)}
    </span>
  )
}

function StatusPill({ row }: { row: AgentRow }) {
  if (row.fromCode) return <Pill tone="info">In code</Pill>
  return <Pill tone={row.status === 'active' ? 'ok' : 'idle'}>{statusLabel(row.status)}</Pill>
}

function AgentsPage() {
  const list = useJson<unknown>(API, 30_000)
  const models = useJson<unknown>('/api/agents/models')
  const hasTraining = !!useManifest()?.pages.some((p) => p.id === 'training')
  const now = useNow()
  const phone = usePhone()
  const rows = useMemo(() => agentRows(list.data), [list.data])
  const usedModels = useMemo(() => [...new Set(rows.map((r) => r.model).filter(Boolean))].sort(), [rows])

  const [query, setQuery] = useState('')
  const [model, setModel] = useState(ALL)
  const [sort, setSort] = useState<ListSort>({ key: 'updated', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState<AgentRow | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => sortAgents(filterAgents(rows, { query, model: model === ALL ? null : model }), sort), [rows, query, model, sort])
  const pageRows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  /** A new filter starts again at the first page. */
  const filter = (q: string, m: string) => {
    setQuery(q)
    setModel(m)
    setPage(1)
  }

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

  const open = (id: string | null, edit = false) => {
    setSelected(id)
    setEditing(edit)
  }
  const save = async (row: AgentRow | null, draft: AgentDraft) => {
    const body = payloadOf(draft)
    const saved = await fetchJson<{ id?: string }>(row ? `${API}/${encodeURIComponent(row.id)}` : API, { method: row ? 'PUT' : 'POST', body })
    void notify(row ? `Saved “${body.name}”` : `Created “${body.name}”`, { type: 'success' })
    list.reload()
    open(saved?.id ?? row?.id ?? null)
  }
  /** Run a request; report the outcome as a toast and refresh the list. */
  const act = async (fail: string, fn: () => Promise<string>) => {
    try {
      void notify(await fn(), { type: 'success' })
      list.reload()
    } catch (e) {
      void notify(`${fail}: ${errorText(e)}`, { type: 'error' })
    }
  }
  const duplicate = (row: AgentRow) =>
    act(`Could not duplicate “${row.name}”`, async () => {
      const copy = await fetchJson<{ id?: string; name?: string }>(`/api/agents/duplicate/${encodeURIComponent(row.id)}`, { method: 'POST' })
      open(copy?.id ?? null)
      return `Created “${copy?.name ?? row.name}”`
    })
  const remove = (row: AgentRow) =>
    act(`Could not delete “${row.name}”`, async () => {
      await fetchJson(`${API}/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (selected === row.id) open(null)
      return `Deleted “${row.name}”`
    })
  const openTraining = (row: AgentRow) => {
    navigate('training')
    const url = new URL(window.location.href)
    url.searchParams.set('agent_id', row.id)
    window.history.replaceState(window.history.state, '', url)
  }

  const current = selected === NEW ? null : (rows.find((r) => r.id === selected) ?? null)
  let detail: ReactNode
  let detailTitle: string | undefined
  if (selected === NEW || (current && editing)) {
    detailTitle = current ? `Edit ${current.name}` : 'New agent'
    detail = (
      <AgentForm
        key={current?.id ?? NEW}
        initial={draftOf(current, defaultModel(models.data))}
        models={modelOptions(models.data, current?.model)}
        isNew={!current}
        onCancel={() => open(current ? current.id : null)}
        onSave={(d) => save(current, d)}
      />
    )
  } else if (current) {
    detailTitle = current.name
    detail = (
      <AgentDetail row={current} now={now} onEdit={() => setEditing(true)} onDuplicate={() => void duplicate(current)} onTraining={hasTraining ? () => openTraining(current) : undefined} onDelete={() => setDeleting(current)} />
    )
  }

  const nameCell = (r: AgentRow) => (
    <span className="flex min-w-0 items-center gap-2.5">
      <Monogram name={r.name} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{r.name}</span>
        {phone && <span className="truncate text-xs font-normal text-muted-foreground">{r.model || 'Default model'}</span>}
      </span>
    </span>
  )
  const status: ListColumn<AgentRow> = { key: 'status', label: 'Status', render: (r) => <StatusPill row={r} /> }
  const columns: ListColumn<AgentRow>[] = phone
    ? [{ key: 'name', label: 'Agent', render: nameCell }, status]
    : [
        { key: 'name', label: 'Name', render: nameCell },
        // The panel shows the description: while it is open the column gives its width to the others.
        ...(detail ? [] : [{ key: 'summary', label: 'Description', render: (r: AgentRow) => <span className="block max-w-[22rem] truncate">{summaryOf(r) || <span className="text-tier-3">No description</span>}</span> }]),
        { key: 'model', label: 'Model', render: (r) => <span className="block max-w-[12rem] truncate font-mono text-xs" title={r.model}>{r.model || '—'}</span> },
        { key: 'tools', label: 'Tools', align: 'end', render: (r) => <span className="tabular-nums">{r.tools.length}</span> },
        {
          key: 'updated',
          label: 'Updated',
          align: 'end',
          render: (r) => (
            <time className="whitespace-nowrap" dateTime={Number.isFinite(r.updated) ? new Date(r.updated).toISOString() : undefined} title={fullTime(r.updated)}>
              {ago(r.updated, now) || '—'}
            </time>
          ),
        },
        status,
      ]

  const newButton = (
    <Button size="sm" onClick={() => open(NEW, true)}><Plus aria-hidden />New agent</Button>
  )
  // No agents yet: the empty state's button is the one way to create one.
  const toolbar =
    !list.loading && !list.error && rows.length === 0 ? undefined : (
      <>
        <div ref={searchRef} className="min-w-[12rem] flex-1 sm:max-w-xs">
          <TemplateSearch label="Search agents" value={query} onChange={(q) => filter(q, model)} placeholder="Search agents" shortcut="/" />
        </div>
        {usedModels.length > 1 && (
          <Select value={model} onValueChange={(m) => filter(query, m)}>
            <SelectTrigger size="sm" aria-label="Model" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All models</SelectItem>
              {usedModels.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <span className="flex-1" />
        {newButton}
      </>
    )

  let empty: ReactNode
  if (list.loading && !list.data) empty = <ListSkeleton />
  else if (list.error && !list.data)
    empty = (
      <EmptyTile bad icon={<TriangleAlert />} title="Agents could not be loaded" text={list.error}>
        <Button size="sm" variant="outline" onClick={list.reload}><RotateCw aria-hidden />Try again</Button>
      </EmptyTile>
    )
  else if (rows.length === 0)
    empty = (
      <EmptyTile icon={<Bot />} title="No agents yet" text="An agent has its own name, model and instructions. Create the first one to get started.">
        {newButton}
      </EmptyTile>
    )
  else
    empty = (
      <EmptyTile icon={<SearchX />} title="No agent matches these filters" text="Try another word, or show every model.">
        <Button size="sm" variant="outline" onClick={() => filter('', ALL)}>Clear filters</Button>
      </EmptyTile>
    )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-aiui-app-page="agents" data-drill-in="">
      {list.error && list.data != null && (
        <p role="alert" className="mx-4 mt-3 flex items-center gap-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-destructive sm:mx-6">
          <span className="min-w-0 flex-1">Could not refresh the agents: {list.error}</span>
          <Button size="xs" variant="outline" onClick={list.reload}>Try again</Button>
        </p>
      )}
      <ListDetail<AgentRow>
        label="Agents"
        columns={columns}
        rows={pageRows}
        selectedId={selected}
        onSelect={(id) => open(id)}
        onOpen={(id) => open(id, !rows.find((r) => r.id === id)?.fromCode)}
        sort={sort}
        onSort={(key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'tools' || key === 'updated' ? 'desc' : 'asc' }))}
        toolbar={toolbar}
        detailTitle={detailTitle}
        detail={detail}
        empty={empty}
        footer={shown.length > 0 ? <ListPagination page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} hints={!phone} /> : undefined}
      />
      <Modal open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this agent?" description={`“${deleting?.name ?? ''}” is removed for good. This cannot be undone.`}>
        <ModalActions>
          <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => {
              if (deleting) void remove(deleting)
              setDeleting(null)
            }}>Delete</Button>
        </ModalActions>
      </Modal>
    </div>
  )
}

function EmptyTile({ icon, title, text, bad, children }: { icon: ReactNode; title: string; text: string; bad?: boolean; children: ReactNode }) {
  return (
    <div role={bad ? 'alert' : undefined} className="flex w-full flex-col items-center gap-2 py-8 text-center">
      <span aria-hidden className={cn('mb-1 flex size-10 items-center justify-center rounded-lg [&_svg]:size-5', bad ? 'bg-danger-soft text-destructive' : 'bg-accent-soft text-link')}>
        {icon}
      </span>
      <p className="m-0 text-base font-medium text-foreground">{title}</p>
      <p className="m-0 max-w-sm text-sm text-muted-foreground">{text}</p>
      <div className="mt-2 flex gap-2">{children}</div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading agents" data-aiui-skeleton="" className="flex w-full flex-col">
      <div className="h-9 border-b border-border bg-code" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex h-10 items-center gap-3 border-b border-border px-3">
          <Skeleton className="size-6 rounded-sm" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="hidden h-3 max-w-72 flex-1 sm:block" />
          <Skeleton className="ml-auto h-3 w-20" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      {text ? <p className="m-0 max-h-60 overflow-y-auto rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground">{text}</p> : <p className="m-0 text-sm text-tier-3">None</p>}
    </div>
  )
}

function AgentDetail({ row, now, onEdit, onDuplicate, onTraining, onDelete }: { row: AgentRow; now: number; onEdit(): void; onDuplicate(): void; onTraining?: () => void; onDelete(): void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Monogram name={row.name} large />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="max-w-full truncate font-mono text-xs text-muted-foreground">{row.model || 'Default model'}</span>
          <StatusPill row={row} />
        </div>
      </div>
      {row.description && <p className="m-0 text-sm text-muted-foreground">{row.description}</p>}
      <Facts
        items={[
          { label: 'Temperature', value: row.temperature },
          { label: 'Tools', value: row.tools.length },
          { label: 'Updated', value: <span title={fullTime(row.updated)}>{ago(row.updated, now) || '—'}</span> },
          { label: 'Created', value: <span title={fullTime(row.created)}>{ago(row.created, now) || '—'}</span> },
        ]}
      />
      <TextBlock label="Instructions" text={row.instructions} />
      <TextBlock label="System prompt" text={row.systemPrompt} />
      {row.tools.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Tools</span>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {row.tools.map((t) => <li key={t} className="rounded-sm bg-muted px-2 py-0.5 font-mono text-xs text-foreground">{t}</li>)}
          </ul>
        </div>
      )}
      {row.fromCode && <p className="m-0 text-sm text-muted-foreground">Your app registers this agent in code, so it cannot be edited here. Duplicate it to get an editable copy.</p>}
      {onTraining && (
        <Button size="sm" variant="link" className="-ml-2 self-start" onClick={onTraining}><FlaskConical aria-hidden />Training history</Button>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {!row.fromCode && (
          <Button size="sm" onClick={onEdit}><PenLine aria-hidden />Edit</Button>
        )}
        <Button size="sm" variant="outline" onClick={onDuplicate}><CopyPlus aria-hidden />Duplicate</Button>
        <span className="flex-1" />
        {!row.fromCode && (
          <Button size="sm" variant="outline" onClick={onDelete}><Trash aria-hidden />Delete</Button>
        )}
      </div>
    </div>
  )
}

function Field({ id, label, help, children }: { id: string; label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {help && <p id={`${id}-help`} className="m-0 text-xs text-tier-3">{help}</p>}
    </div>
  )
}

function AgentForm({ initial, models, isNew, onCancel, onSave }: { initial: AgentDraft; models: readonly string[]; isNew: boolean; onCancel(): void; onSave(d: AgentDraft): Promise<void> }) {
  const id = useId()
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof AgentDraft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const text = (k: keyof AgentDraft, help?: boolean) => ({ id: `${id}-${k}`, value: draft[k], onChange: (e: { target: { value: string } }) => set(k)(e.target.value), 'aria-describedby': help ? `${id}-${k}-help` : undefined })

  return (
    <form
      noValidate
      aria-label={isNew ? 'New agent' : 'Edit agent'}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const problem = draftError(draft)
        setError(problem)
        if (problem) return
        setSaving(true)
        onSave(draft).catch((err: unknown) => {
          setError(errorText(err))
          setSaving(false)
        })
      }}
    >
      <Field id={`${id}-name`} label="Name">
        <Input {...text('name')} required aria-required autoFocus />
      </Field>
      <Field id={`${id}-description`} label="Description" help="One line that says what the agent is for.">
        <Input {...text('description', true)} />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
        <Field id={`${id}-model`} label="Model">
          {models.length > 0 ? (
            <Select value={draft.model} onValueChange={set('model')}>
              <SelectTrigger id={`${id}-model`} className="w-full">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input {...text('model')} />
          )}
        </Field>
        <Field id={`${id}-temperature`} label="Temperature">
          <Input {...text('temperature')} type="number" inputMode="decimal" min={0} max={2} step={0.1} />
        </Field>
      </div>
      <Field id={`${id}-instructions`} label="Instructions" help="What the agent does and how it answers.">
        <Textarea {...text('instructions', true)} rows={6} />
      </Field>
      <Field id={`${id}-systemPrompt`} label="System prompt" help="Optional. Sent before every conversation.">
        <Textarea {...text('systemPrompt', true)} rows={3} />
      </Field>
      {error && <p role="alert" className="m-0 rounded-md bg-danger-soft px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving && <Spinner size="sm" />}
          {isNew ? 'Create agent' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

const AgentsAppPage = inLayoutOnly(AgentsPage)
export default AgentsAppPage
