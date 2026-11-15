/**
 * A code artifact: line numbers and Shiki highlighting in both themes, from
 * the chat's own lazy highlighter (markdown/pluginLoaders: the Shiki chunk
 * and each grammar load on first use, never with this feature), and the
 * output of a run when the server ran it.
 */
import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import { SquareTerminal } from 'lucide-react'
import { loadCodePlugin, SHIKI_THEMES } from '@/markdown/pluginLoaders'
import { cn } from '@/lib/utils'
import { relativeTime } from '../format'
import type { RunState } from '../hooks'
import '../artifacts.css'

type Token = { content: string; color?: string; htmlStyle?: Record<string, string> }

function useHighlight(code: string, language: string): Token[][] | null {
  const [tokens, setTokens] = useState<{ key: string; lines: Token[][] } | null>(null)
  const key = `${language}\n${code}`
  useEffect(() => {
    let live = true
    loadCodePlugin().then(
      (plugin) => {
        const done = (r: { tokens: Token[][] } | null) => live && r && setTokens({ key, lines: r.tokens })
        // themes is part of the plugin contract; the curated plugin uses its own pair.
        done(plugin.highlight({ code, language: language as never, themes: SHIKI_THEMES }, done) as { tokens: Token[][] } | null)
      },
      () => undefined, // plain text stays
    )
    return () => {
      live = false
    }
  }, [code, language, key])
  return tokens?.key === key ? tokens.lines : null
}

function tokenStyle(t: Token): CSSProperties | undefined {
  const s = t.htmlStyle
  const color = s?.color ?? t.color
  if (!color && !s) return undefined
  const out: Record<string, string> = {}
  if (color) out.color = color
  if (s?.['--shiki-dark']) out['--shiki-dark'] = s['--shiki-dark']
  return out as CSSProperties
}

export default function CodeViewer({ code, language, run, className }: {
  code: string
  language: string
  run?: RunState
  className?: string
}): JSX.Element {
  const tokens = useHighlight(code, language)
  const lines = code.split('\n')
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <div className="flex overflow-x-auto bg-code py-3 font-mono" data-aiui-art-code>
        <pre aria-hidden className="m-0 select-none pr-3.5 pl-4 text-right text-tier-3">
          {lines.map((_, i) => `${i + 1}\n`)}
        </pre>
        <pre className="m-0 min-w-0 pr-4 text-foreground">
          <code>
            {tokens
              ? tokens.map((line, i) => (
                  <span key={i}>
                    {line.map((t, j) => (
                      <span key={j} style={tokenStyle(t)}>
                        {t.content}
                      </span>
                    ))}
                    {i < tokens.length - 1 ? '\n' : ''}
                  </span>
                ))
              : code}
          </code>
        </pre>
      </div>
      {run && (run.running || run.result) && (
        <div className="flex flex-wrap items-start gap-3 border-t border-hairline px-4 py-2.5" aria-live="polite">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-tier-2">
            <SquareTerminal className="size-3.5" aria-hidden />
            Output
          </span>
          {run.running ? (
            <span className="text-sm text-tier-3">Running. The server may ask you to approve the run first.</span>
          ) : run.result ? (
            <>
              <pre
                className={cn(
                  'm-0 max-h-60 min-w-0 flex-1 overflow-auto font-mono text-xs whitespace-pre-wrap',
                  run.result.status === 'success' ? 'text-foreground' : 'text-destructive',
                )}
              >
                {[run.result.output, run.result.error].filter(Boolean).join('\n') ||
                  (run.result.status === 'success' ? 'No output' : `The run ended: ${run.result.status}`)}
              </pre>
              <span className="ml-auto text-xs text-tier-3 tabular-nums">
                Ran {relativeTime(run.result.at)} · {(run.result.durationMs / 1000).toFixed(2)}s
              </span>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
