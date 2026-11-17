/**
 * Plain-language text for the explained approval card and the keyboard
 * strip. Pure: runs under node --test.
 */

export const isHighRisk = (risk?: string) => risk === 'high' || risk === 'critical'

// What a gate acts on: in ./command, small enough for the chat route's inline gate.
export { commandLabel, commandOf } from './command'

/**
 * Whether the gate runs a shell command (a non-empty `command` / `cmd`, the
 * argument commandOf shows first): the card then says "wants to run a
 * command" and prefixes `$`. Code (`code`, `script`) is not a shell line.
 */
export function isShellCommand(args: Readonly<Record<string, unknown>> | undefined): boolean {
  return ['command', 'cmd'].some((k) => {
    const v = args?.[k]
    return typeof v === 'string' ? !!v.trim() : Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')
  })
}

/** The agent's name, or "the agent". */
const who = (agent?: string) => agent?.trim() || 'the agent'

/**
 * Card heading: "Researcher wants to run a command" when the gate is a shell
 * command (the design), else "Allow Researcher to use web_search?".
 */
export function gateTitle(agent: string | undefined, tool: string, isCommand = false): string {
  if (isCommand) {
    const name = who(agent)
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} wants to run a command`
  }
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
    `Nothing runs until you decide. Approve lets ${who(agent)} run it once; Deny tells it to go on without this step.`,
  ]
}
