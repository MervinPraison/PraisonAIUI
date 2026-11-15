/**
 * Plain-language steps of one assistant turn (ADR 0003 §3, Guided Studio):
 * what the agent did, in words a newcomer reads at a glance. Pure: no React,
 * no DOM, so it runs under node --test.
 *
 *   tool        the server's `artifact.label` wins; then the tool name:
 *               shell / exec / terminal   "Running a command"
 *               search                    "Searching the web" (documents,
 *                                         memory, knowledge: "Searching your documents")
 *               read / write              "Reading {file}" / "Saving {file}"
 *               fetch / browse / a url    "Visiting {host}"
 *               anything else             "Using {Tool}"
 *   reasoning   "Understanding your question", meta "thought for Ns"
 *   text        "Writing the answer" (all of the turn's text is one step)
 *   a gate      "Waiting for your OK" until it is decided
 *
 * A step's meta is the first line of its result, at most 40 characters.
 */
import type { ChatMessageView, ChatPartView, ChatToolPartView } from '@/sdk/layoutTypes'

export type StepKind = 'reasoning' | 'tool' | 'text'
export type StepStatus = 'running' | 'done' | 'error' | 'waiting' | 'skipped'

export interface PlainStep {
  /** The part id (text: the first text part's id). */
  id: string
  kind: StepKind
  label: string
  status: StepStatus
  /** Short result line: "found Python 3.12.4", "thought for 2s". */
  meta?: string
  durationMs?: number
  /** For "Show details": the raw tool name, what it ran, the full first result line, the reasoning text. */
  detail?: { tool?: string; input?: string; output?: string; text?: string }
}

export const META_MAX = 40

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export function clip(text: string, max = META_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** "web_search" → "Web search", "getWeather" → "Get weather". */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.:/]+/g, ' ')
    .trim()
    .toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'a tool'
}

const FILE_KEYS = ['path', 'file', 'filename', 'file_path', 'filepath', 'target']
const INPUT_KEYS = ['command', 'cmd', 'code', 'script', 'query', 'q', 'url', 'path', 'file', 'filename', 'file_path']

function fileName(args: Readonly<Record<string, unknown>>): string | undefined {
  for (const k of FILE_KEYS) {
    const v = str(args[k])
    if (v) return v.split(/[\\/]/).filter(Boolean).pop() ?? v
  }
  return undefined
}

function host(args: Readonly<Record<string, unknown>>): string | undefined {
  const url = str(args.url) ?? str(args.link) ?? str(args.href)
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}

/** What a tool call did, in plain words. */
export function toolLabel(toolName: string, args: Readonly<Record<string, unknown>> = {}, artifact: Readonly<Record<string, unknown>> = {}): string {
  const server = str(artifact.label)
  if (server) return server
  const name = toolName.toLowerCase()
  const site = host(args)
  if (/(^|[_\-\s])(shell|exec|execute|terminal|bash|zsh|sh|command|cmd|subprocess|run_?command|powershell)([_\-\s]|$)/.test(name)) {
    return 'Running a command'
  }
  if (/search|lookup|retriev/.test(name)) {
    return /doc|file|memory|knowledge|rag|vector|note/.test(name) ? 'Searching your documents' : 'Searching the web'
  }
  if (/(fetch|browse|visit|crawl|scrape|http|url|webpage|web_?page|open_?url)/.test(name) || (site && !/file/.test(name))) {
    return site ? `Visiting ${site}` : 'Visiting a web page'
  }
  if (/(write|save|create|edit|append|update|put)/.test(name) && /(file|doc|note|disk)/.test(name)) {
    const f = fileName(args)
    return f ? `Saving ${f}` : 'Saving a file'
  }
  if (/(read|open|load|cat|view|get)/.test(name) && /(file|doc|note|disk)/.test(name)) {
    const f = fileName(args)
    return f ? `Reading ${f}` : 'Reading a file'
  }
  return `Using ${humanize(toolName)}`
}

const RESULT_KEYS = ['output', 'stdout', 'text', 'result', 'content', 'message', 'answer', 'summary']

/** The first non-empty line of a result (a string, a common field, else compact JSON); '' when there is none. */
export function firstLine(result: unknown): string {
  let text: string | undefined
  if (typeof result === 'string') text = result
  else if (typeof result === 'number' || typeof result === 'boolean') text = String(result)
  else if (result && typeof result === 'object' && !Array.isArray(result)) {
    const rec = result as Record<string, unknown>
    for (const k of RESULT_KEYS) {
      text = str(rec[k])
      if (text) break
    }
    if (!text) {
      try {
        text = JSON.stringify(result)
      } catch {
        text = undefined
      }
    }
  } else if (Array.isArray(result)) {
    text = result.length ? `${result.length} result${result.length === 1 ? '' : 's'}` : 'no results'
  }
  if (!text) return ''
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
  return line ?? ''
}

/** What a tool was given, on one line (`python3 --version`), for the details list. */
export function toolInput(args: Readonly<Record<string, unknown>> = {}): string {
  for (const k of INPUT_KEYS) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) return clip(v, 120)
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return clip(v.join(' '), 120)
  }
  if (!Object.keys(args).length) return ''
  try {
    return clip(JSON.stringify(args), 120)
  } catch {
    return ''
  }
}

const elapsed = (t?: { startedAt: number; completedAt?: number }): number | undefined =>
  t && typeof t.completedAt === 'number' && t.completedAt >= t.startedAt ? t.completedAt - t.startedAt : undefined

/** "0.3s", "2s", "1m 5s". */
export function formatSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 950) return `${Math.max(0.1, Math.round(ms / 100) / 10)}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
}

/** "less than a second", "1 second", "3 seconds", "2 minutes 5 seconds". */
export function spokenDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return 'less than a second'
  const s = Math.round(ms / 1000)
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  if (s < 60) return unit(s, 'second')
  const m = Math.floor(s / 60)
  return s % 60 ? `${unit(m, 'minute')} ${unit(s % 60, 'second')}` : unit(m, 'minute')
}

function toolStep(p: ChatToolPartView, turnRunning: boolean): PlainStep {
  const label = toolLabel(p.toolName, p.args, p.artifact)
  const durationMs = elapsed(p.timing)
  const detail = { tool: p.toolName, input: toolInput(p.args) || undefined, output: p.result === undefined ? undefined : firstLine(p.result) || undefined }
  const approval = p.approval
  if (approval && approval.approved === undefined) {
    return { id: p.id, kind: 'tool', label: 'Waiting for your OK', status: 'waiting', meta: clip(label), detail }
  }
  if (approval && approval.approved === false) {
    return { id: p.id, kind: 'tool', label, status: 'skipped', meta: 'you said not now', detail }
  }
  const out = firstLine(p.result)
  if (p.isError) return { id: p.id, kind: 'tool', label, status: 'error', meta: out ? clip(out) : "it didn't work", durationMs, detail }
  if (p.result === undefined && !p.timing?.completedAt) {
    return { id: p.id, kind: 'tool', label, status: turnRunning ? 'running' : 'done', durationMs, detail }
  }
  return { id: p.id, kind: 'tool', label, status: 'done', meta: out ? clip(out) : undefined, durationMs, detail }
}

const isRunning = (m: ChatMessageView) => m.status?.type === 'running' || m.status?.type === 'requires-action'

/** The turn's steps, in order. Data parts (images, references) are not steps. */
export function deriveSteps(message: ChatMessageView): PlainStep[] {
  const running = isRunning(message)
  const steps: PlainStep[] = []
  let text: PlainStep | null = null
  const parts: readonly ChatPartView[] = message.parts ?? []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.type === 'reasoning') {
      const ms = elapsed(p.timing)
      const status: StepStatus = p.done || running === false ? 'done' : 'running'
      steps.push({
        id: p.id,
        kind: 'reasoning',
        label: 'Understanding your question',
        status,
        meta: status === 'done' && ms !== undefined ? `thought for ${formatSeconds(ms)}` : undefined,
        durationMs: ms,
        detail: str(p.text) ? { text: p.text.trim() } : undefined,
      })
    } else if (p.type === 'tool-call') {
      // A stopped turn's unfinished call shows as running here, then as skipped below.
      steps.push(toolStep(p, running || message.status?.type === 'incomplete'))
    } else if (p.type === 'text' && p.text.trim()) {
      if (!text) {
        text = { id: p.id, kind: 'text', label: 'Writing the answer', status: 'done' }
        steps.push(text)
      }
      // While a gate waits, the text so far is written, not being written.
      text.status = message.status?.type === 'running' && i === parts.length - 1 ? 'running' : 'done'
    }
  }
  if (message.status?.type === 'incomplete') {
    // A stopped or failed turn: the step that was going on did not finish.
    for (const s of steps) if (s.status === 'running') s.status = message.status.reason === 'error' ? 'error' : 'skipped'
  }
  return steps
}

/** True when a turn has more to show than its answer (a step that is not the text). */
export const hasWork = (steps: readonly PlainStep[]) => steps.some((s) => s.kind !== 'text')

export interface TrackerSummary {
  /** "Here is what Researcher did" */
  title: string
  /** "All done in 3 seconds", "Waiting for your OK", "Working on step 2 of 3" */
  status: string
  state: 'running' | 'waiting' | 'done' | 'stopped' | 'error'
}

/** The tracker's heading and status line. */
export function summarize(message: ChatMessageView, steps: readonly PlainStep[]): TrackerSummary {
  const agent = str(message.agentName) ?? 'the assistant'
  const status = message.status?.type
  const waiting = steps.some((s) => s.status === 'waiting')
  if (waiting || status === 'requires-action') {
    return { title: `Here is what ${agent} did so far`, status: 'Waiting for your OK', state: 'waiting' }
  }
  if (status === 'running') {
    const at = steps.findIndex((s) => s.status === 'running')
    const n = at < 0 ? steps.length : at + 1
    return { title: `Here is what ${agent} is doing`, status: `Working on step ${n}`, state: 'running' }
  }
  if (status === 'incomplete') {
    return message.status?.type === 'incomplete' && message.status.reason === 'error'
      ? { title: `Here is what ${agent} did`, status: 'Something went wrong', state: 'error' }
      : { title: `Here is what ${agent} did`, status: 'You stopped it', state: 'stopped' }
  }
  const total =
    typeof message.completedAt === 'number' && message.completedAt >= message.createdAt
      ? message.completedAt - message.createdAt
      : steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)
  const took = total > 0 ? spokenDuration(total) : ''
  return { title: `Here is what ${agent} did`, status: took ? `All done in ${took}` : 'All done', state: 'done' }
}

/** One step's status line: "Done · thought for 2s", "Working…", "Waiting for your OK". */
export function stepMeta(step: PlainStep): string {
  const head =
    step.status === 'done' ? 'Done'
      : step.status === 'running' ? 'Working…'
        : step.status === 'waiting' ? 'Needs your OK'
          : step.status === 'skipped' ? 'Skipped'
            : 'Problem'
  return step.meta ? `${head} · ${step.meta}` : head
}
