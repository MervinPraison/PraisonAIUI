/**
 * Plain-language text for the explained approval card and the keyboard
 * strip. Pure: runs under node --test.
 */

export const isHighRisk = (risk?: string) => risk === 'high' || risk === 'critical'

const COMMAND_KEYS = ['command', 'cmd', 'code', 'script', 'query', 'url', 'path', 'file', 'filename'] as const
const MAX = 160

function clip(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > MAX ? `${t.slice(0, MAX - 1)}…` : t
}

/**
 * What the tool will act on, for a one-line code chip: the first of the usual
 * command-like arguments, else the arguments as compact JSON. Empty when the
 * tool has no arguments.
 */
export function commandOf(args: Readonly<Record<string, unknown>> | undefined): string {
  if (!args) return ''
  for (const k of COMMAND_KEYS) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) return clip(v)
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return clip(v.join(' '))
  }
  if (!Object.keys(args).length) return ''
  try {
    return clip(JSON.stringify(args))
  } catch {
    return ''
  }
}

/** The label of the chip that shows commandOf(): "Command", "Address", "File"… */
export function commandLabel(args: Readonly<Record<string, unknown>> | undefined): string {
  if (!args) return 'Details'
  for (const k of COMMAND_KEYS) {
    const v = args[k]
    if ((typeof v === 'string' && v.trim()) || Array.isArray(v)) {
      if (k === 'url') return 'Address'
      if (k === 'path' || k === 'file' || k === 'filename') return 'File'
      if (k === 'query') return 'Query'
      return 'Command'
    }
  }
  return 'Details'
}

/** The agent's name, or "the agent". */
const who = (agent?: string) => agent?.trim() || 'the agent'

/** Card heading: "Allow Researcher to use terminal?" */
export function gateTitle(agent: string | undefined, tool: string): string {
  return `Allow ${who(agent)} to use ${tool}?`
}

/**
 * The answer to "Why am I asked?": why the step waits, from the risk level
 * the server sent, then what each choice does.
 */
export function whyAsked(risk: string | undefined, tool: string, agent?: string): string[] {
  const level = (risk ?? '').toLowerCase()
  const reason =
    level === 'critical' || level === 'high'
      ? `${tool} is marked ${level} risk: it can change files, settings or data, or reach outside this chat. Your server asks before every such step.`
      : level === 'medium'
        ? `${tool} does more than read, so your server's approval policy asks before it runs.`
        : `Your server's approval policy asks before ${tool} runs.`
  return [
    reason,
    `Nothing runs until you decide. Approve lets ${who(agent)} run it once; Not now tells it to go on without this step.`,
  ]
}
