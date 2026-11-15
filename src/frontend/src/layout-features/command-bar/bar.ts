/**
 * What the command bar does with its text (ADR 0003 §3 "Command bar
 * actions"). Pure.
 *
 *   `/…` or `>…`   run a command: the one cmdk palette, opened with the rest
 *                  typed in (the stack has a single palette)
 *   anything else  ask: the text goes to the chat (sent; the frame decides)
 */
export type BarIntent = { kind: 'none' } | { kind: 'palette'; query: string } | { kind: 'ask'; text: string }

export const COMMAND_PREFIXES: readonly string[] = ['/', '>']

export function barIntent(raw: string): BarIntent {
  const lead = raw.trimStart()
  if (lead && COMMAND_PREFIXES.includes(lead[0])) return { kind: 'palette', query: lead.slice(1).trimStart() }
  const text = raw.trim()
  return text ? { kind: 'ask', text } : { kind: 'none' }
}
