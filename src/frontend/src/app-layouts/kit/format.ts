import type { ApprovalItem } from '@/sdk/layoutTypes'

/** An approval's call as one line (`pip install numpy`), at most 200 characters. */
export function describeCall(item: Pick<ApprovalItem, 'toolName' | 'args'>): string {
  const args = item.args ?? {}
  const values = Object.values(args)
  const text =
    values.length === 1 && typeof values[0] === 'string'
      ? values[0]
      : `${item.toolName ?? 'tool'}(${Object.keys(args).length ? JSON.stringify(args) : ''})`
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
}
