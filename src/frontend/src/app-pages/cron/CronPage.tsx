/**
 * Cron (ProList.dc.html), the app shell's page for `cron` inside a layout: toolbar, a table
 * (schedule in words and as cron, next and last run, an enabled switch), a detail panel (recent
 * runs, Run now, Edit, Delete with a confirm) and the create/edit form; on a phone the detail
 * replaces the list. Data: /api/schedules and its history (builtin.cron), polled every 15 s.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CalendarClock, Play, Plus, RotateCw, SquarePen, Trash } from 'lucide-react'
import { ListDetail, ListPagination, type ListColumn, type ListSort } from '@/components/page/ListDetail'
import { Facts, Glyph, TemplateSearch } from '@/components/page/parts'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/sdk/notify'
import { fetchJson } from '@/sdk/services'
import { ago, fullTime, inLayoutOnly, StatusDot, useJson, useNow, type Tone } from '../shared'
import { Modal, ModalActions } from '../Modal'
import { describeSchedule, filterRows, jobRows, nextRun, runHistory, sortRows, until, type JobRow, type RunEntry, type StatusFilter } from './model'
import { Chip, ScheduleForm, type ScheduleInput } from './ScheduleForm'

const PAGE_SIZE = 20
const CHIPS: readonly [StatusFilter, string][] = [['all', 'All'], ['enabled', 'Enabled'], ['paused', 'Paused'], ['failing', 'Failing']]
const RESULT: Record<string, [Tone, string]> = { succeeded: ['ok', 'Succeeded'], failed: ['bad', 'Failed'], skipped: ['idle', 'Skipped'] }
const result = (status: string | null | undefined): [Tone, string] => RESULT[status ?? ''] ?? ['idle', 'Ran']
const url = (id: string, tail = '') => `/api/schedules/${encodeURIComponent(id)}${tail}`

const PHONE = '(max-width: 639px)'
const onPhoneChange = (fn: () => void) => {
  const mq = window.matchMedia(PHONE)
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}

/** The empty and error states: shell/primitives EmptyState's look, with an icon tile. */
function EmptyState({ icon, title, description, role, children }: { icon: ReactNode; title: string; description: string; role?: 'alert'; children: ReactNode }) {
  return (
    <div role={role} className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="mb-2 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-link [&_svg]:size-5">{icon}</span>
      <h2 className="m-0 text-base font-medium text-foreground">{title}</h2>
      <p className="m-0 text-sm text-balance text-muted-foreground">{description}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  )
}

function NextRun({ row, now }: { row: JobRow; now: number }) {
  const next = nextRun(row, now)
  if (!next) return <span className="text-tier-3">{row.enabled ? '—' : 'Paused'}</span>
  return <span title={fullTime(next.at)}>{next.due ? 'Due now' : until(next.at, now)}</span>
}

function CronPage() {
  const list = useJson<{ cron_available?: boolean }>('/api/schedules', 15_000)
  const history = useJson<unknown>('/api/schedules/history', 15_000)
  const now = useNow(15_000)
  const phone = useSyncExternalStore(onPhoneChange, () => window.matchMedia(PHONE).matches, () => false)
  const rows = useMemo(() => jobRows(list.data), [list.data])
  const runs = useMemo(() => runHistory(history.data), [history.data])

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<ListSort>({ key: 'name', dir: 'asc' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState<{ job: JobRow | null } | null>(null)
  const [deleting, setDeleting] = useState<JobRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // The switch moves at once; the next read of the list replaces this.
  const [toggled, setToggled] = useState<{ of: unknown; ids: Record<string, boolean> }>({ of: null, ids: {} })
  const flips = toggled.of === list.data ? toggled.ids : {}

  const view = rows.map((r) => ({ ...r, enabled: flips[r.id] ?? r.enabled, lastStatus: r.lastStatus ?? runs.find((h) => h.jobId === r.id)?.status ?? null }))
  const shown = sortRows(filterRows(view, query, status), sort, now)
  const current = view.find((r) => r.id === selected) ?? null

  /** Call the API, say what failed, then read the list again. */
  const act = async (failed: string, fn: () => Promise<unknown>) => {
    await fn().catch((e: unknown) => void notify(`${failed}: ${e instanceof Error ? e.message : String(e)}`, { type: 'error' }))
    list.reload()
    history.reload()
  }
  const toggle = (row: JobRow) => {
    setToggled((t) => ({ of: list.data, ids: { ...(t.of === list.data ? t.ids : {}), [row.id]: !row.enabled } }))
    void act(`Could not ${row.enabled ? 'pause' : 'enable'} “${row.name}”`, () => fetchJson(url(row.id, '/toggle'), { method: 'POST' }))
  }
  const runNow = (row: JobRow) => {
    setBusy(row.id)
    void act('Run failed', async () => {
      const r = await fetchJson<{ status?: string; result?: string }>(url(row.id, '/run'), { method: 'POST' }).finally(() => setBusy(null))
      const ok = r.status === 'succeeded'
      void notify(ok ? `“${row.name}” ran` : `“${row.name}” ${result(r.status)[1].toLowerCase()}: ${r.result ?? ''}`, { type: ok ? 'success' : 'error' })
    })
  }
  const remove = (row: JobRow) =>
    act('Delete failed', async () => {
      await fetchJson(url(row.id), { method: 'DELETE' })
      if (selected === row.id) setSelected(null)
      void notify(`Deleted “${row.name}”`, { type: 'success' })
    })
  const save = async (job: JobRow | null, input: ScheduleInput) => {
    const saved = await fetchJson<{ id?: string }>(job ? url(job.id) : '/api/schedules', { method: job ? 'PUT' : 'POST', body: input })
    if (saved.id) setSelected(saved.id)
    list.reload()
  }

  const enabledCol: ListColumn<JobRow> = {
    key: 'enabled',
    label: 'Enabled',
    render: (r) => (
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <Switch checked={r.enabled} onCheckedChange={() => toggle(r)} aria-label={`${r.enabled ? 'Pause' : 'Enable'} ${r.name}`} />
      </span>
    ),
  }
  const wide: ListColumn<JobRow>[] = [
    { key: 'name', label: 'Name', render: (r) => <span className="block max-w-[16rem] truncate">{r.name}</span> },
    { key: 'agent', label: 'Agent', render: (r) => r.agent ?? 'Default agent' },
    { key: 'schedule', label: 'Schedule', render: (r) => <span className="flex items-baseline gap-2 text-foreground">{describeSchedule(r.schedule)}<code className="font-mono text-xs text-tier-3">{r.schedule.cron_expr}</code></span> },
    { key: 'next', label: 'Next run', render: (r) => <NextRun row={r} now={now} /> },
    { key: 'last', label: 'Last run', render: (r) => (Number.isFinite(r.lastRun) ? <StatusDot tone={result(r.lastStatus)[0]}>{`${ago(r.lastRun, now)}, ${result(r.lastStatus)[1].toLowerCase()}`}</StatusDot> : <span className="text-tier-3">Never</span>) },
    enabledCol,
  ]
  // On a phone, and beside the open detail panel at any width, a row is the name over its
  // schedule and next run, plus the switch: the table always fits (the panel has the rest).
  const compactCol: ListColumn<JobRow> = {
    key: 'name',
    label: 'Schedule',
    render: (r) => (
      <span className="flex min-w-0 flex-col py-2 whitespace-normal">
        <span className="truncate">{r.name}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {describeSchedule(r.schedule)} · <NextRun row={r} now={now} />
        </span>
      </span>
    ),
  }
  const columns = phone || current ? [compactCol, enabledCol] : wide

  const newButton = <Button size="sm" onClick={() => setForm({ job: null })}><Plus aria-hidden />New schedule</Button>
  const toolbar = (
    <>
      <div className="min-w-[12rem] flex-1 sm:max-w-xs"><TemplateSearch label="Search schedules" value={query} onChange={(q) => (setQuery(q), setPage(1))} /></div>
      <div role="group" aria-label="Status" className="flex items-center gap-1">
        {CHIPS.map(([id, label]) => <Chip key={id} on={status === id} onClick={() => (setStatus(id), setPage(1))}>{label}</Chip>)}
      </div>
      <span className="flex-1" />
      {newButton}
    </>
  )

  const empty =
    list.error && !list.data ? (
      <EmptyState role="alert" icon={<RotateCw aria-hidden />} title="Could not load schedules" description={list.error}>
        <Button size="sm" variant="outline" onClick={() => list.reload()}><RotateCw aria-hidden />Try again</Button>
      </EmptyState>
    ) : list.loading ? (
      <div className="flex w-full flex-col gap-3" aria-busy="true" aria-label="Loading schedules">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
      </div>
    ) : rows.length === 0 ? (
      <EmptyState icon={<CalendarClock aria-hidden />} title="No scheduled jobs yet" description="Run an agent on a timetable: a morning briefing, an hourly check, a weekly report.">
        {newButton}
      </EmptyState>
    ) : (
      <p className="m-0 text-sm text-muted-foreground">No schedule matches these filters.</p>
    )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-aiui-app-page="cron" data-drill-in="">
      {list.data?.cron_available === false && rows.some((r) => r.schedule.kind === 'cron') && (
        <p role="status" className="mx-4 mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning sm:mx-6">Daily, weekly and custom schedules need the croniter package on the server (pip install croniter). Until then only minute and hour intervals run.</p>
      )}
      <ListDetail<JobRow>
        label="Schedules"
        columns={columns}
        rows={shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        selectedId={selected}
        onSelect={setSelected}
        onOpen={(id) => setForm({ job: view.find((r) => r.id === id) ?? null })}
        sort={sort}
        onSort={(key) => key !== 'schedule' && key !== 'enabled' && setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}
        toolbar={toolbar}
        detailTitle={current?.name}
        detail={current && <JobDetail row={current} runs={runs.filter((h) => h.jobId === current.id)} now={now} busy={busy === current.id} onRun={() => runNow(current)} onEdit={() => setForm({ job: current })} onDelete={() => setDeleting(current)} onBack={() => setSelected(null)} />}
        empty={empty}
        footer={shown.length > 0 ? <ListPagination page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} /> : undefined}
      />
      {form && <ScheduleForm key={form.job?.id ?? 'new'} job={form.job} onClose={() => setForm(null)} onSave={(input) => save(form.job, input)} />}
      <Modal open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this schedule?" description={`“${deleting?.name ?? ''}” stops running and is removed. Pause it instead to keep it.`}>
        <ModalActions>
          <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => (deleting && void remove(deleting), setDeleting(null))}>Delete</Button>
        </ModalActions>
      </Modal>
    </div>
  )
}

function JobDetail(p: { row: JobRow; runs: RunEntry[]; now: number; busy: boolean; onRun(): void; onEdit(): void; onDelete(): void; onBack(): void }) {
  const { row, now, row: { schedule: s } } = p
  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" className="-ml-2 self-start sm:hidden" onClick={p.onBack}><Glyph name="left" />All schedules</Button>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={p.onRun} disabled={p.busy}><Play aria-hidden />{p.busy ? 'Running…' : 'Run now'}</Button>
        <Button size="sm" variant="outline" onClick={p.onEdit}><SquarePen aria-hidden />Edit</Button>
        <Button size="sm" variant="outline" onClick={p.onDelete}><Trash aria-hidden />Delete</Button>
      </div>
      <Facts
        items={[
          { label: 'Schedule', value: describeSchedule(s) },
          s.cron_expr ? { label: 'Cron (UTC)', value: <code className="font-mono text-sm">{s.cron_expr}</code> } : { label: 'Created', value: ago(row.created, now) },
          { label: 'Next run', value: <NextRun row={row} now={now} /> },
          { label: 'Last run', value: Number.isFinite(row.lastRun) ? `${result(row.lastStatus)[1]}, ${ago(row.lastRun, now)}` : 'Never' },
          { label: 'Agent', value: row.agent ?? 'Default agent' },
          { label: 'Runs', value: row.runs },
        ]}
      />
      <section aria-label="Prompt" className="flex flex-col gap-1.5">
        <h3 className="m-0 text-xs font-medium text-tier-3">Prompt</h3>
        <p className="m-0 rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground">{row.message || 'No prompt: the job is skipped.'}</p>
      </section>
      <section aria-label="Recent runs" className="flex flex-col gap-2">
        <h3 className="m-0 text-xs font-medium text-tier-3">Recent runs</h3>
        {p.runs.length === 0 && <p className="m-0 text-sm text-muted-foreground">No runs since the server started.</p>}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {p.runs.slice(0, 8).map((r) => (
            <li key={r.at} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 text-xs tabular-nums">
                <StatusDot tone={result(r.status)[0]}>{result(r.status)[1]}</StatusDot>
                <span className="text-tier-3" title={fullTime(r.at)}>{`${ago(r.at, now)} · ${r.duration.toFixed(1)} s`}</span>
              </span>
              {r.result && <p className="m-0 line-clamp-2 text-sm text-muted-foreground">{r.result}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

const CronAppPage = inLayoutOnly(CronPage)
export default CronAppPage
