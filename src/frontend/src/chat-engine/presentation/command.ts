/**
 * What an approval gate will act on, for a one-line code chip. Kept apart
 * from ./gateText so the chat route's inline gate (Thread) carries only this,
 * not the explained card's wording. Pure: runs under node --test.
 */

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
