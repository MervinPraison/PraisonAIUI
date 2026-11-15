/**
 * Plain-language text for the explained approval card and the keyboard
 * strip. Pure: runs under node --test.
 */

export const isHighRisk = (risk?: string) => risk === 'high' || risk === 'critical'

// What a gate acts on: in ./command, small enough for the chat route's inline gate.
export { commandLabel, commandOf } from './command'

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
