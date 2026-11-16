/**
 * Create or edit a scheduled job: name, prompt, agent and a schedule builder (every N minutes
 * or hours, daily or weekly at a UTC time, or custom cron checked as you type) with the next runs.
 */
import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useJson, useNow } from '../shared'
import { Modal, ModalActions } from '../Modal'
import { clock, DAY_NAMES, describeSchedule, draftSchedule, NEW_DRAFT, nextRuns, parseCron, scheduleDraft, until, type Draft, type JobRow, type Repeat, type Schedule } from './model'

export type ScheduleInput = { name: string; message: string; agent_name: string | null; agent_id: null; schedule: Schedule }

const REPEATS: readonly [Repeat, string][] = [['minutes', 'Every few minutes'], ['hours', 'Every few hours'], ['daily', 'Every day'], ['weekly', 'On certain days'], ['custom', 'Custom (cron)']]
const DEFAULT_AGENT = '__default__'

function Field({ label, htmlFor, help, children }: { label: string; htmlFor?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {help && <p className="m-0 text-xs text-tier-3">{help}</p>}
    </div>
  )
}

/** A toggle chip: the page's status filters and the builder's weekdays. */
export function Chip({ on, onClick, label, children }: { on: boolean; onClick(): void; label?: string; children: ReactNode }) {
  const look = on ? 'border-transparent bg-accent-soft text-link' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
  return <button type="button" aria-pressed={on} aria-label={label} onClick={onClick} className={cn('h-8 min-w-11 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', look)}>{children}</button>
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange(v: string): void; options: readonly (readonly [string, string])[] }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, text]) => <SelectItem key={v} value={v}>{text}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  )
}

/** In words, then the next three runs (or the first, for an interval). */
function preview(s: Schedule, now: number): string {
  if (s.kind === 'every') return `First run ${until(now + (s.every_seconds ?? 0) * 1000, now)}, then on that interval.`
  const spec = parseCron(s.cron_expr ?? '').spec
  const runs = spec ? nextRuns(spec, now, 3) : []
  return runs.length ? `Next runs, your time: ${runs.map((t) => clock(t, now)).join(' · ')}` : 'This expression never matches a date.'
}

/** Mounted while open; keyed by the job, so each opening starts from it. */
export function ScheduleForm({ job, onClose, onSave }: { job: JobRow | null; onClose(): void; onSave(input: ScheduleInput): Promise<void> }) {
  const id = useId()
  const agents = useJson<{ agents?: { name?: string }[] }>('/api/agents')
  const [name, setName] = useState(job?.name ?? '')
  const [message, setMessage] = useState(job?.message ?? '')
  const [agent, setAgent] = useState(job?.agent ?? DEFAULT_AGENT)
  const [initial] = useState<Draft>(() => (job ? scheduleDraft(job.schedule) : NEW_DRAFT))
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const names = [...new Set([...(agents.data?.agents ?? []).map((a) => a.name ?? ''), job?.agent ?? ''])].filter(Boolean)
  // Untouched timing keeps the stored schedule as is (the builder has no seconds: 90 s would become 2 min).
  const built = job && draft === initial ? { schedule: job.schedule, error: undefined } : draftSchedule(draft)
  const now = useNow()
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const submit = async () => {
    if (!name.trim() || !message.trim()) return setError('Give the schedule a name and a prompt.')
    if (!built.schedule) return setError(built.error)
    setSaving(true)
    const input = { name: name.trim(), message: message.trim(), agent_name: agent === DEFAULT_AGENT ? null : agent, agent_id: null, schedule: built.schedule }
    await onSave(input).then(onClose, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    setSaving(false)
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={job ? 'Edit schedule' : 'New schedule'} description="Send a prompt to an agent on a timetable.">
      <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Morning briefing" autoFocus />
        </Field>
        <Field label="Prompt" htmlFor={`${id}-msg`}>
          <Textarea id={`${id}-msg`} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="For example: summarise yesterday's chats in five bullet points" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice label="Agent" value={agent} onChange={setAgent} options={[[DEFAULT_AGENT, 'Default agent'], ...names.map((n) => [n, n] as const)]} />
          <Choice label="Repeat" value={draft.repeat} onChange={(v) => set({ repeat: v as Repeat })} options={REPEATS} />
        </div>
        {(draft.repeat === 'minutes' || draft.repeat === 'hours') && (
          <Field label={`Every how many ${draft.repeat}`} htmlFor={`${id}-every`} help="Counted from the last run, or from when you save.">
            <Input id={`${id}-every`} type="number" inputMode="numeric" min={1} className="w-28" value={Number.isNaN(draft.every) ? '' : draft.every} onChange={(e) => set({ every: e.target.valueAsNumber })} />
          </Field>
        )}
        {draft.repeat === 'weekly' && (
          <div role="group" aria-label="Days" className="flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <Chip key={d} label={DAY_NAMES[d]} on={draft.days.includes(d)} onClick={() => set({ days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d] })}>
                {DAY_NAMES[d].slice(0, 3)}
              </Chip>
            ))}
          </div>
        )}
        {(draft.repeat === 'daily' || draft.repeat === 'weekly') && (
          <Field label="At (UTC)" htmlFor={`${id}-time`} help="Cron runs on the server's UTC clock.">
            <Input id={`${id}-time`} type="time" className="w-32" value={draft.time} onChange={(e) => set({ time: e.target.value })} />
          </Field>
        )}
        {draft.repeat === 'custom' && (
          <Field label="Cron expression" htmlFor={`${id}-cron`} help="Minute, hour, day of month, month, weekday, in UTC. Example: 30 8 * * 1-5">
            <Input id={`${id}-cron`} className="font-mono" value={draft.cron} onChange={(e) => set({ cron: e.target.value })} aria-invalid={!!built.error} aria-describedby={`${id}-preview`} spellCheck={false} />
          </Field>
        )}
        <div id={`${id}-preview`} aria-live="polite" className={cn('rounded-md px-3 py-2 text-sm', built.error ? 'bg-danger-soft text-destructive' : 'bg-muted')}>
          <p className="m-0 font-medium">{built.schedule ? describeSchedule(built.schedule) : built.error}</p>
          {built.schedule && <p className="m-0 text-xs text-muted-foreground tabular-nums">{preview(built.schedule, now)}</p>}
        </div>
        {error && <p role="alert" className="m-0 rounded-md bg-danger-soft px-3 py-2 text-sm text-destructive">{error}</p>}
        <ModalActions>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{job ? 'Save changes' : 'Create schedule'}</Button>
        </ModalActions>
      </form>
    </Modal>
  )
}
