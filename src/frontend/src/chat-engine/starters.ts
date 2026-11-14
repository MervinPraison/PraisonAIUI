import type { AiuiStarter } from './useAiuiRuntime'

/**
 * Shown when the app configured no starters: a first-time visitor gets a few
 * ideas. Each is an unfinished prompt (`fill`), so a click puts it in the
 * composer for the visitor to complete; sending a fragment would spend a
 * model turn on it.
 */
export const DEFAULT_STARTERS: AiuiStarter[] = [
  { title: 'Summarize a document', label: 'Paste text or attach a file', prompt: 'Summarize this in five bullet points:\n\n', fill: true },
  { title: 'Write code', label: 'Describe what it should do', prompt: 'Write a small Python function that ', fill: true },
  { title: 'Plan a task', label: 'Break it into steps', prompt: 'Help me plan this task step by step: ', fill: true },
  { title: 'Explain a concept', label: 'In plain words', prompt: 'Explain in plain words: ', fill: true },
]

/** Prompts that fill the composer rather than send (template starters). */
export function fillPrompts(starters: readonly AiuiStarter[] | undefined): ReadonlySet<string> {
  return new Set((starters ?? []).filter((s) => s.fill).map((s) => s.prompt))
}
