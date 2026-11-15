/**
 * Guided Studio's templates: the app's starters (`@aiui.starters`, YAML
 * `chat.starters`, GET /starters) with their optional `category`,
 * `description` and `icon`, or a plain-language default set when the app
 * configured none. Using one opens a new chat with the prompt in the
 * composer, ready to edit and send (nothing is sent for the visitor).
 *
 * Pure apart from loadTemplates() (one GET, cached for the tab); tested in
 * guided.test.ts.
 */

export interface GuidedTemplate {
  id: string
  title: string
  description?: string
  prompt: string
  category: string
  /** A short mark (an emoji) from the app, else none (the card shows the category's icon). */
  icon?: string
}

export const OTHER_CATEGORY = 'More ideas'

/** Shown when the app has no starters: each prompt is the start of a request to finish. */
export const DEFAULT_TEMPLATES: readonly GuidedTemplate[] = Object.freeze([
  { id: 'd-summarize', category: 'Write', title: 'Summarize a document', description: 'Paste text or add a file, get the key points', prompt: 'Summarize this in five short bullet points:\n\n' },
  { id: 'd-email', category: 'Write', title: 'Draft a friendly email', description: 'Tell it who it is for and what to say', prompt: 'Write a short, friendly email to ' },
  { id: 'd-explain', category: 'Learn', title: 'Explain something simply', description: 'In plain words, with an example', prompt: 'Explain in plain words, with one example: ' },
  { id: 'd-compare', category: 'Learn', title: 'Compare options', description: 'A table of pros and cons', prompt: 'Compare these options in a table with pros and cons: ' },
  { id: 'd-plan', category: 'Plan', title: 'Plan a task step by step', description: 'Break a goal into small steps', prompt: 'Help me plan this step by step: ' },
  { id: 'd-ideas', category: 'Plan', title: 'Brainstorm ideas', description: 'Ten ideas to choose from', prompt: 'Give me ten ideas for ' },
  { id: 'd-code', category: 'Code', title: 'Write a small program', description: 'Describe what it should do', prompt: 'Write a small Python program that ' },
  { id: 'd-data', category: 'Analyse', title: 'Look at some numbers', description: 'Paste data and ask a question', prompt: 'Here is some data. What stands out?\n\n' },
])

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
/** A short mark (an emoji or a couple of characters); a longer `icon` is an icon name the cards do not draw. */
const mark = (v: unknown): string | undefined => {
  const s = str(v)
  return s && [...s].length <= 3 ? s : undefined
}

/** The server's starters (`{starters: [...]}` or a list) as templates; entries without a prompt are dropped. */
export function normalizeStarters(data: unknown): GuidedTemplate[] {
  const raw = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as { starters?: unknown }).starters : undefined
  if (!Array.isArray(raw)) return []
  const out: GuidedTemplate[] = []
  raw.forEach((s, i) => {
    if (!s || typeof s !== 'object') return
    const r = s as Record<string, unknown>
    const prompt = str(r.message) ?? str(r.prompt)
    if (!prompt) return
    const title = str(r.label) ?? str(r.title) ?? (prompt.length > 60 ? `${prompt.slice(0, 59)}…` : prompt)
    const description = str(r.description) ?? (title !== prompt ? (prompt.length > 90 ? `${prompt.slice(0, 89)}…` : prompt) : undefined)
    out.push({ id: `s-${i}`, title, description, prompt, category: str(r.category) ?? OTHER_CATEGORY, icon: mark(r.icon) })
  })
  return out
}

/** Categories in first-seen order, each with its templates. */
export function groupByCategory(list: readonly GuidedTemplate[]): { name: string; items: GuidedTemplate[] }[] {
  const groups = new Map<string, GuidedTemplate[]>()
  for (const t of list) {
    const g = groups.get(t.category)
    if (g) g.push(t)
    else groups.set(t.category, [t])
  }
  return [...groups].map(([name, items]) => ({ name, items }))
}

/** Templates whose title, description, prompt or category contain every word of `query`. */
export function filterTemplates(list: readonly GuidedTemplate[], query: string, category?: string): GuidedTemplate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return list.filter((t) => {
    if (category && t.category !== category) return false
    const hay = `${t.title} ${t.description ?? ''} ${t.prompt} ${t.category}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

let cache: Promise<GuidedTemplate[]> | null = null

/**
 * The app's starters, or DEFAULT_TEMPLATES when it has none or the request
 * fails. One request per tab: the same promise every call (safe for use()).
 */
export function loadTemplates(): Promise<GuidedTemplate[]> {
  cache ??= fetch('/starters', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const list = normalizeStarters(data)
      return list.length ? list : [...DEFAULT_TEMPLATES]
    })
    .catch(() => [...DEFAULT_TEMPLATES])
  return cache
}

/** Test hook. */
export function resetTemplatesForTests(): void {
  cache = null
}
