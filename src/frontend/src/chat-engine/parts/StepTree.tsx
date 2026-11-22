/** data-step renderer (lazy chunk): a reply's steps as a collapsible tree (name, status, duration from the server's times). */
import { useId, useState, type FC } from 'react'
import { Check, ChevronRight, Square, X } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { AiuiStep } from '../protocol'
import { formatDuration } from '../util'

const PRE = 'max-h-60 overflow-auto border-l-2 border-border pl-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground'

const STATUS_LABEL: Record<string, string> = { running: 'Running', done: 'Done', error: 'Failed', stopped: 'Stopped' }

function StatusIcon({ status }: { status: AiuiStep['status'] }) {
  if (status === 'running') return <Spinner className="size-3.5" />
  if (status === 'error') return <X className="size-3.5 text-destructive" aria-hidden />
  if (status === 'stopped') return <Square className="size-3" aria-hidden />
  return <Check className="size-3.5" aria-hidden />
}

const StepNode: FC<{ step: AiuiStep; all: AiuiStep[] }> = ({ step, all }) => {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const children = all.filter((x) => x.parent_id === step.step_id)
  const hasBody = Boolean(step.input || step.output || step.error || children.length)
  const took = step.start !== undefined && step.end !== undefined ? formatDuration(step.end - step.start) : ''
  return (
    <li className="min-w-0" data-part="step" data-step-status={step.status}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasBody}
        aria-expanded={hasBody ? open : undefined}
        aria-controls={open && hasBody ? panelId : undefined}
        className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground" title={STATUS_LABEL[step.status]}>
          <StatusIcon status={step.status} />
        </span>
        <span className="min-w-0 truncate font-medium text-foreground" data-step-name>{step.name || 'Step'}</span>
        {step.step_type && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{step.step_type}</span>}
        <span className="sr-only">{STATUS_LABEL[step.status]}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {took && <span className="text-xs tabular-nums text-muted-foreground" data-step-duration>{took}</span>}
          {hasBody && (
            <ChevronRight className={cn('size-3.5 text-muted-foreground motion-safe:transition-transform motion-safe:duration-[120ms]', open && 'rotate-90')} aria-hidden />
          )}
        </span>
      </button>
      {open && hasBody && (
        <div id={panelId} className="ml-3.5 space-y-2 border-l border-border py-1 pl-3">
          {step.input && <pre className={PRE} data-step-input>{step.input}</pre>}
          {step.output && <pre className={PRE} data-step-output>{step.output}</pre>}
          {step.error && <p className="text-xs break-words text-destructive" data-step-error>{step.error}</p>}
          {children.length > 0 && (
            <ul className="space-y-0.5">
              {children.map((c) => <StepNode key={c.step_id} step={c} all={all} />)}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

export default function StepTree({ data }: { data: { steps?: AiuiStep[] } }) {
  const steps = data.steps ?? []
  const ids = new Set(steps.map((x) => x.step_id))
  const roots = steps.filter((x) => !x.parent_id || !ids.has(x.parent_id))
  return (
    <ul className="my-1.5 min-w-0" data-step-tree>
      {roots.map((r) => <StepNode key={r.step_id} step={r} all={steps} />)}
    </ul>
  )
}
