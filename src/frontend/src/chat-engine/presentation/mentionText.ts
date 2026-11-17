/** The composer's "@" (ArtifactMention.tsx): the mention text and the list of titles, kept apart from the component. */
import type { Artifact } from '@/sdk/layoutTypes'

/**
 * The message with `@"title" ` at the selection. `typed`: the @ the viewer
 * just typed before the caret becomes the mention's own.
 */
export function insertMention(text: string, start: number, end: number, title: string, typed: boolean): { text: string; caret: number } {
  const from = typed && text[start - 1] === '@' ? start - 1 : start
  const before = text.slice(0, from)
  const mention = `${before && !/\s$/.test(before) ? ' ' : ''}@"${title.replace(/"/g, "'")}" `
  return { text: before + mention + text.slice(end), caret: before.length + mention.length }
}

/** One entry per artifact (its latest title), in first-appearance order. */
export function mentionTitles(versions: readonly Artifact[]): { key: string; title: string }[] {
  const byKey = new Map<string, string>()
  for (const a of versions) byKey.set(a.key, a.title)
  return [...byKey].map(([key, title]) => ({ key, title }))
}
