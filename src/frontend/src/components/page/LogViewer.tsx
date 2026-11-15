/**
 * Log viewer page template (ProLogs.dc.html): level toggles with counts, a
 * search with "n of m" and previous/next match, "only matching lines", a
 * monospaced time · level · source · message grid, and rows that expand to
 * their detail. Follows the tail while the list is scrolled to the bottom.
 *
 * Used by React pages directly, and by the `log_viewer` block
 * (LogViewerBlock below, registered lazily by blocks/coreBlocks.tsx).
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Glyph, TemplateSearch } from './parts'
import {
  countLevels,
  entryMatches,
  filterEntries,
  LOG_LEVELS,
  normalizeLevel,
  splitMatches,
  stepMatch,
  type LogLevel,
} from './model'
import './page.css'

export interface LogEntry {
  id: string
  /** Display time ("15:20:31.204"). */
  ts: string
  /** Any logger spelling: WARNING, warn, ERROR, critical… */
  level: string
  source?: string
  message: string
  /** Shown when the row is expanded: text (as a code block) or nodes. */
  detail?: ReactNode
}

export interface LogViewerProps {
  /** Accessible name ("Log lines"). */
  label: string
  entries: readonly LogEntry[]
  /** Levels shown at first (default: all). */
  initialLevels?: readonly LogLevel[]
  /** Extra controls at the end of the filter bar (Pause, Download…). */
  actions?: ReactNode
  /** Keep the newest line in view while scrolled to the bottom (default true). */
  follow?: boolean
  emptyText?: string
  className?: string
}

const LEVEL_LABEL: Record<LogLevel, string> = { debug: 'Debug', info: 'Info', warn: 'Warn', error: 'Error' }

function Highlight({ text, query, current }: { text: string; query: string; current: boolean }) {
  const parts = splitMatches(text, query)
  const firstMatch = parts.findIndex((p) => p.match)
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} aria-current={(current && i === firstMatch) || undefined}>
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  )
}

export function LogViewer({ label, entries, initialLevels, actions, follow = true, emptyText, className }: LogViewerProps) {
  const [levels, setLevels] = useState<ReadonlySet<LogLevel>>(() => new Set(initialLevels ?? LOG_LEVELS))
  const [query, setQuery] = useState('')
  const [onlyMatches, setOnlyMatches] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [matchAt, setMatchAt] = useState(-1)
  const listRef = useRef<HTMLOListElement>(null)
  const atBottom = useRef(true)
  const searchId = useId()

  const counts = useMemo(() => countLevels(entries), [entries])
  const shown = useMemo(() => filterEntries(entries, levels, query, onlyMatches), [entries, levels, query, onlyMatches])
  const matches = useMemo(() => (query.trim() ? shown.filter((e) => entryMatches(e, query)).map((e) => e.id) : []), [shown, query])
  const currentMatch = matchAt >= 0 && matchAt < matches.length ? matches[matchAt] : null

  // Follow the tail only while the reader is at the bottom.
  useEffect(() => {
    const el = listRef.current
    if (follow && el && atBottom.current && !currentMatch) el.scrollTop = el.scrollHeight
  }, [shown.length, follow, currentMatch])

  useEffect(() => {
    if (!currentMatch) return
    listRef.current?.querySelector(`[data-entry-id="${CSS.escape(currentMatch)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [currentMatch])

  const toggle = (lvl: LogLevel) =>
    setLevels((prev) => {
      const next = new Set(prev)
      if (next.has(lvl)) next.delete(lvl)
      else next.add(lvl)
      return next
    })
  const step = (delta: number) => setMatchAt((at) => stepMatch(at, matches.length, delta))

  return (
    <div className={['aiui-tpl aiui-tpl-log', className].filter(Boolean).join(' ')} data-aiui-template="log">
      <div role="toolbar" aria-label="Filter logs" className="aiui-tpl-toolbar">
        <div role="group" aria-label="Levels" className="aiui-tpl-levels">
          {LOG_LEVELS.map((lvl) => (
            <Button
              key={lvl}
              type="button"
              variant="outline"
              className="aiui-tpl-level"
              data-level={lvl}
              aria-pressed={levels.has(lvl)}
              onClick={() => toggle(lvl)}
            >
              {LEVEL_LABEL[lvl]}
              <span className="aiui-tpl-count">{counts[lvl].toLocaleString()}</span>
            </Button>
          ))}
        </div>
        <span className="aiui-tpl-grow" />
        <div className="aiui-tpl-log-match">
          <TemplateSearch
            label="Search log messages"
            value={query}
            onChange={(v) => {
              setQuery(v)
              setMatchAt(v.trim() ? 0 : -1)
            }}
          />
          {query.trim() && (
            <span id={searchId} role="status" className="aiui-tpl-matches">
              {matches.length ? `${Math.max(0, matchAt) + 1} of ${matches.length}` : 'No matches'}
            </span>
          )}
          <Button type="button" variant="ghost" size="icon" aria-label="Previous match" disabled={!matches.length} onClick={() => step(-1)}>
            <Glyph name="up" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Next match" disabled={!matches.length} onClick={() => step(1)}>
            <Glyph name="down" />
          </Button>
        </div>
        <label className="aiui-tpl-check">
          <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
          Only matching lines
        </label>
        {actions}
      </div>
      <div className="aiui-tpl-log-head" aria-hidden="true">
        <span>Time</span>
        <span>Level</span>
        <span>Source</span>
        <span>Message</span>
      </div>
      {shown.length === 0 ? (
        <div className="aiui-tpl-empty">{emptyText ?? (entries.length ? 'No lines match these filters.' : 'No log lines yet.')}</div>
      ) : (
        <ol
          ref={listRef}
          className="aiui-tpl-log-lines"
          aria-label={label}
          role="log"
          aria-live="off"
          onScroll={(e) => {
            const el = e.currentTarget
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
        >
          {shown.map((e) => {
            const lvl = normalizeLevel(e.level)
            const expanded = open === e.id
            const detailId = `${searchId}-${e.id}`
            return (
              <li key={e.id} className="aiui-tpl-log-item" data-entry-id={e.id} data-open={expanded || undefined}>
                <button
                  type="button"
                  className="aiui-tpl-log-row"
                  aria-expanded={e.detail != null ? expanded : undefined}
                  aria-controls={e.detail != null && expanded ? detailId : undefined}
                  onClick={() => setOpen(expanded ? null : e.id)}
                >
                  <span className="aiui-tpl-log-ts">{e.ts}</span>
                  <span className="aiui-tpl-lvl" data-level={lvl}>
                    {lvl.toUpperCase()}
                  </span>
                  <span className="aiui-tpl-log-src" title={e.source}>
                    {e.source}
                  </span>
                  <span className="aiui-tpl-log-msg">
                    <Highlight text={e.message} query={query} current={e.id === currentMatch} />
                  </span>
                </button>
                {expanded && e.detail != null && (
                  <div id={detailId} className="aiui-tpl-log-detail">
                    {typeof e.detail === 'string' ? (
                      <pre>
                        <code>{e.detail}</code>
                      </pre>
                    ) : (
                      e.detail
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

export default LogViewer
