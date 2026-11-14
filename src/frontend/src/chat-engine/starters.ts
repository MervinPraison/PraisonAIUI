import type { AiuiStarter } from './useAiuiRuntime'

/** Shown when the app configured no starters: a first-time visitor gets a few ideas. */
export const DEFAULT_STARTERS: AiuiStarter[] = [
  { title: 'Summarize a document', label: 'Attach a file and get the key points', prompt: 'Summarize the attached document in five bullet points.' },
  { title: 'Write code', label: 'Describe what it should do', prompt: 'Write a small Python function that ' },
  { title: 'Plan a task', label: 'Break it into steps', prompt: 'Help me plan this task step by step: ' },
  { title: 'Explain a concept', label: 'In plain words', prompt: 'Explain in plain words: ' },
]
