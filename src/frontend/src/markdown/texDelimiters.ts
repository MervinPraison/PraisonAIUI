/**
 * LaTeX delimiters LLMs emit by default — `\[…\]` (display) and `\(…\)`
 * (inline) — become remark-math's `$$` form, outside code. remark-math has no
 * such delimiters (markdown reads `\[` as an escaped bracket), so without this
 * the TeX shows as raw text.
 *
 * Only complete pairs are rewritten; code fences (``` / ~~~) and inline code
 * spans are left exactly as written.
 */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const DISPLAY = /\\\[([\s\S]+?)\\\]/g
const INLINE = /\\\(([^\n]+?)\\\)/g

/** Cheap check before doing any work. */
export const TEX_DELIM_RE = /\\[[(]/

function rewriteProse(text: string): string {
  // Inline code spans: split on backtick runs; odd segments are code.
  const parts = text.split(/(`+[^`]*`+)/)
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(DISPLAY, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
      .replace(INLINE, (_m, body: string) => `$$${body.trim()}$$`)
  }
  return parts.join('')
}

export function normalizeTexDelimiters(md: string): string {
  if (!TEX_DELIM_RE.test(md)) return md
  const out: string[] = []
  let prose: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (prose.length) out.push(rewriteProse(prose.join('\n')))
    prose = []
  }
  for (const line of md.split('\n')) {
    const m = FENCE.exec(line)
    if (fence) {
      out.push(line)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null
    } else if (m) {
      flush()
      fence = m[1]
      out.push(line)
    } else {
      prose.push(line)
    }
  }
  flush()
  return out.join('\n')
}
