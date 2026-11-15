/**
 * The `log_viewer` block: block props to the LogViewer template. Registered
 * lazily by blocks/coreBlocks.tsx, in its own chunk. The template does not
 * depend on the block layer, so a React page uses it without the blocks chunk.
 */
import { useMemo } from 'react'
import { arr, display, isRecord, str } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'
import { LogViewer, type LogEntry } from '../LogViewer'

/**
 * `{type: "log_viewer", title, entries: [{ts | time, level, source | logger,
 *   message, detail}]}`; `detail` may be a string or a dict (shown as JSON).
 */
export function LogViewerBlock({ node }: { node: BlockNode }) {
  const p = node.props ?? {}
  const entries = useMemo<LogEntry[]>(
    () =>
      arr(p.entries ?? p.lines)
        .filter(isRecord)
        .map((e, i) => ({
          id: str(e.id, String(i)),
          ts: str(e.ts ?? e.time ?? e.timestamp),
          level: str(e.level, 'info'),
          source: e.source != null || e.logger != null ? str(e.source ?? e.logger) : undefined,
          message: display(e.message ?? e.msg ?? ''),
          detail: e.detail == null ? undefined : typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail, null, 2),
        })),
    [p.entries, p.lines],
  )
  return <LogViewer label={str(p.title ?? p.label, 'Log lines')} entries={entries} />
}
