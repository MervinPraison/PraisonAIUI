/**
 * The artifact rules (ADR 0003 §3): the ONE place that decides what in a chat
 * is an artifact, what it is called, and when a later one is a new version
 * of an earlier one. The server (`features/artifacts.py`) never re-derives:
 * it stores what this module produces, so the rules live here only.
 *
 *   assistant text   fenced code of `minLines`+ lines (default 3) and GFM
 *                    tables of `minRows`+ body rows (default 2); a fence in
 *                    `md`/`markdown` is a markdown document
 *   data parts       `element` (file, image, pdf, video, audio, code) and
 *                    `a2ui` surfaces; a tool's `artifact.a2ui` counts too
 *
 * Keys (stable within a session, so history reloads give the same ones):
 *   - a fence's file name: `title="x.py"` / `filename=` / `file=` in the
 *     info string, `python x.py`, `x.py` alone, a first line
 *     `# file: x.py` (or `//`, `--`, `<!-- -->`), or a line just before the
 *     fence that is only a file name (`**x.py**`, `` `x.py`: ``);
 *   - a table's header signature, `table:<col>|<col>…`. A later table whose
 *     label (the heading, bold line or `…:` line just above it) matches, or
 *     whose first column matches and whose columns include or are included
 *     in an earlier table's, keeps that table's key: adding a column is a
 *     new version, not a new table;
 *   - an element's name (`file:<name>`), else its URL; an A2UI surface id;
 *   - otherwise the kind and its count in the session (`code:python:2`).
 *
 * Versions: the first appearance of a key is v1; a later appearance with
 * different content is v+1 (in a later turn or later in the same reply).
 * The same content again adds no version: that message just mentions the
 * existing one. Pure: no React, no fetch, no DOM.
 */
import type { Artifact, ArtifactKind } from '@/sdk/layoutTypes'

export const DEFAULT_MIN_LINES = 3
export const DEFAULT_MIN_ROWS = 2
/** At or above these, the chat shows a card instead of the block inline (chat-canvas). */
export const COLLAPSE_LINES = 12
export const COLLAPSE_ROWS = 6

export interface DeriveOptions {
  /** Fewest lines a fence needs to be an artifact (`layout.options.chat-canvas.minLines`). */
  minLines?: number
  /** Fewest body rows a table needs. */
  minRows?: number
}

/** The message shape derivation reads: ChatMessageView, or the chat store's AiuiMessage. */
export interface DeriveMessage {
  id: string
  role: string
  createdAt: number
  completedAt?: number
  agentName?: string
  parts: readonly DerivePart[]
}

export type DerivePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning' }
  | { type: 'tool-call'; artifact?: Readonly<Record<string, unknown>> }
  | { type: 'data'; name: string; data: unknown }
  | { type: string }

/** An artifact version with what the canvas shows about it. Structurally an `Artifact`. */
export interface DerivedArtifact extends Artifact {
  /** The agent whose reply made it (absent for a user version). */
  agent?: string
  /** Code and markdown: line count. */
  lines?: number
  /** Tables: body rows and header cells. */
  rows?: number
  columns?: readonly string[]
  /** User versions: the version it restores. */
  restoredFrom?: number
}

export interface Derived {
  /** Every version, grouped by key in first-appearance order, oldest version first. */
  versions: DerivedArtifact[]
  /** messageId → the versions that message shows, in order (one per key). */
  mentions: Record<string, DerivedArtifact[]>
}

// ── markdown scanning ────────────────────────────────────────────────

export interface FenceBlock {
  type: 'fence'
  /** Resolved language id ('' when none). */
  language: string
  filename?: string
  body: string
  lines: number
  closed: boolean
}

export interface TableBlock {
  type: 'table'
  header: string[]
  rows: string[][]
  /** The table's markdown lines, as written. */
  source: string
  label?: string
}

export type Block = FenceBlock | TableBlock

const LANG_ALIASES: Record<string, string> = {
  py: 'python', python3: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', yml: 'yaml', md: 'markdown', rb: 'ruby', rs: 'rust',
  kt: 'kotlin', cs: 'csharp', 'c++': 'cpp', htm: 'html', jsonc: 'json', golang: 'go',
}
const EXT_LANG: Record<string, string> = {
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
  json: 'json', sh: 'bash', bash: 'bash', zsh: 'bash', md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml',
  html: 'html', htm: 'html', css: 'css', sql: 'sql', rs: 'rust', go: 'go', java: 'java', rb: 'ruby', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', kt: 'kotlin', swift: 'swift', php: 'php', toml: 'toml', ini: 'ini',
  xml: 'xml', svg: 'xml', txt: 'text', csv: 'csv', dockerfile: 'docker',
}
const LANG_NAMES: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', tsx: 'TSX', jsx: 'JSX', json: 'JSON', bash: 'Shell',
  markdown: 'Markdown', yaml: 'YAML', html: 'HTML', css: 'CSS', sql: 'SQL', rust: 'Rust', go: 'Go', java: 'Java', ruby: 'Ruby',
  c: 'C', cpp: 'C++', csharp: 'C#', kotlin: 'Kotlin', swift: 'Swift', php: 'PHP', toml: 'TOML', ini: 'INI', xml: 'XML',
  text: 'Text', csv: 'CSV', docker: 'Dockerfile', diff: 'Diff', mermaid: 'Mermaid', graphql: 'GraphQL',
}
export const LANG_EXT: Record<string, string> = {
  python: 'py', javascript: 'js', typescript: 'ts', tsx: 'tsx', jsx: 'jsx', json: 'json', bash: 'sh', markdown: 'md',
  yaml: 'yaml', html: 'html', css: 'css', sql: 'sql', rust: 'rs', go: 'go', java: 'java', ruby: 'rb', c: 'c', cpp: 'cpp',
  csharp: 'cs', kotlin: 'kt', swift: 'swift', php: 'php', toml: 'toml', ini: 'ini', xml: 'xml', csv: 'csv', mermaid: 'mmd',
}

export function resolveLang(lang: string | undefined): string {
  const l = (lang ?? '').trim().toLowerCase()
  return LANG_ALIASES[l] ?? l
}

/** A language's display name: `Python`, `Shell`, else the id itself. */
export function languageName(lang: string | undefined): string {
  const l = resolveLang(lang)
  return LANG_NAMES[l] ?? (l ? l[0].toUpperCase() + l.slice(1) : 'Code')
}

const FILENAME = /^(?:[\w@+-][\w.@+-]*\/)*[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,10}$/
const isFilename = (s: string) => FILENAME.test(s) && !/^\d+(\.\d+)+$/.test(s)

function langFromFilename(name: string): string {
  const base = name.split('/').pop() ?? name
  if (/^dockerfile$/i.test(base)) return 'docker'
  return EXT_LANG[base.split('.').pop()?.toLowerCase() ?? ''] ?? ''
}

/** `{language, filename}` from a fence's info string. */
export function parseInfo(info: string): { language: string; filename?: string } {
  let rest = info.trim()
  let filename: string | undefined
  const attr = /\b(?:title|filename|file|name|path)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i.exec(rest)
  if (attr) {
    filename = (attr[1] ?? attr[2] ?? attr[3] ?? '').trim() || undefined
    rest = (rest.slice(0, attr.index) + rest.slice(attr.index + attr[0].length)).trim()
  }
  const tokens = rest.replace(/[{}]/g, ' ').split(/\s+/).filter(Boolean)
  let first = tokens[0] ?? ''
  const colon = /^([\w+#-]+):(.+)$/.exec(first)
  if (colon && isFilename(colon[2])) {
    first = colon[1]
    filename ??= colon[2]
  }
  if (first && isFilename(first) && !LANG_NAMES[resolveLang(first)]) {
    filename ??= first
    first = ''
  } else if (!filename && tokens[1] && isFilename(tokens[1])) {
    filename = tokens[1]
  }
  const language = resolveLang(first) || (filename ? langFromFilename(filename) : '')
  return { language, filename }
}

const FILE_COMMENT = /^\s*(?:#|\/\/|--|;|<!--|\/\*)\s*(?:file(?:name)?|path)\s*:\s*(\S+?)\s*(?:-->|\*\/)?\s*$/i

/** Markdown inline marks removed, for labels and cell text. */
export function plainText(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?!\s)(.+?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1')
    .trim()
}

/** A label line just above a table: a heading, a bold-only line, or a short line ending in ':'. */
function labelOf(line: string): string | undefined {
  const t = line.trim()
  let m = /^#{1,6}\s+(.+?)\s*#*$/.exec(t)
  if (!m) m = /^(?:\*\*|__)(.+?)(?:\*\*|__):?$/.exec(t)
  if (!m && t.endsWith(':') && t.length <= 41) m = [t, t.slice(0, -1)] as unknown as RegExpExecArray
  if (!m) return undefined
  const label = plainText(m[1]).replace(/:$/, '').trim()
  return label && label.length <= 80 ? label : undefined
}

/** A line that only names a file (`**x.py**`, `` `x.py`: ``, `x.py`). */
function filenameLine(line: string): string | undefined {
  const t = plainText(line.trim().replace(/:$/, '')).replace(/:$/, '').trim()
  return t && isFilename(t) ? t : undefined
}

/** Cells of a table row: outer pipes dropped, split on `|` outside code spans and escapes. */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  let tick = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '`') {
      let n = 1
      while (s[i + n] === '`') n++
      tick = tick === 0 ? n : tick === n ? 0 : tick
      cur += s.slice(i, i + n)
      i += n - 1
    } else if (ch === '|' && tick === 0) {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/

/** Fences and tables in a markdown text, in order. */
export function scanMarkdown(text: string): Block[] {
  const lines = text.split(/\r?\n/)
  const out: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i])
    if (open && !(open[2][0] === '`' && open[3].includes('`'))) {
      const [, indent, marks, info] = open
      const close = new RegExp(`^\\s*${marks[0] === '`' ? '`' : '~'}{${marks.length},}\\s*$`)
      const body: string[] = []
      let j = i + 1
      for (; j < lines.length && !close.test(lines[j]); j++) {
        body.push(indent && lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j])
      }
      const { language, filename: fromInfo } = parseInfo(info)
      let filename = fromInfo
      if (!filename && body.length) filename = FILE_COMMENT.exec(body[0])?.[1]
      if (!filename) {
        let k = i - 1
        while (k >= 0 && !lines[k].trim()) k--
        if (k >= 0 && i - k <= 2) filename = filenameLine(lines[k])
      }
      while (body.length && !body[body.length - 1].trim()) body.pop()
      out.push({
        type: 'fence',
        language: language || (filename ? langFromFilename(filename) : ''),
        filename: filename && isFilename(filename) ? filename : undefined,
        body: body.join('\n'),
        lines: body.length,
        closed: j < lines.length,
      })
      i = j
      continue
    }
    if (lines[i].includes('|') && i + 1 < lines.length && DELIMITER.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(lines[i])
      const delims = splitRow(lines[i + 1])
      if (header.length !== delims.length || header.length < 1 || (header.length === 1 && !lines[i].includes('|'))) continue
      const rows: string[][] = []
      let j = i + 2
      for (; j < lines.length && lines[j].trim() && lines[j].includes('|') && !FENCE_OPEN.test(lines[j]); j++) {
        const cells = splitRow(lines[j])
        rows.push(header.map((_, c) => cells[c] ?? ''))
      }
      let k = i - 1
      while (k >= 0 && !lines[k].trim()) k--
      out.push({
        type: 'table',
        header,
        rows,
        source: lines.slice(i, j).join('\n'),
        label: k >= 0 ? labelOf(lines[k]) : undefined,
      })
      i = j - 1
    }
  }
  return out
}

/** A table artifact's content parsed back: header and rows. */
export function parseTable(content: string): { header: string[]; rows: string[][] } {
  const t = scanMarkdown(content).find((b): b is TableBlock => b.type === 'table')
  return t ? { header: t.header, rows: t.rows } : { header: [], rows: [] }
}

/** A table as CSV (RFC 4180 quoting), cell markup removed. */
export function tableToCsv(content: string): string {
  const { header, rows } = parseTable(content)
  const q = (s: string) => {
    const v = plainText(s)
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'
}

// ── derivation ───────────────────────────────────────────────────────

interface Found {
  /** Proposed key (tables may be re-keyed to an earlier table). */
  key: string
  kind: ArtifactKind
  title: string
  language?: string
  content?: string
  url?: string
  mimeType?: string
  lines?: number
  rows?: number
  columns?: string[]
  label?: string
  /** Kind+index keys are numbered per session after the fact. */
  counter?: string
  /** A2UI: this message's messages for the surface (versions are cumulative). */
  a2ui?: unknown[]
}

const ELEMENT_KINDS: Record<string, ArtifactKind> = { image: 'image', pdf: 'pdf', video: 'video', code: 'code', file: 'file', audio: 'file' }

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** The server's `MAX_KEY` (features/artifacts.py, counted in code points): a longer key is refused with a 400. */
export const MAX_KEY = 300

/**
 * A key the server takes: a key over MAX_KEY (a wide table's header
 * signature, a long URL or file name) becomes its first code points, `~` and
 * a hash of the whole key, so it stays stable and distinct. Sliced by code
 * point, so no lone surrogate breaks encodeURIComponent.
 */
export function boundKey(key: string): string {
  const points = Array.from(key)
  if (points.length <= MAX_KEY) return key
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193)
  return `${points.slice(0, MAX_KEY - 9).join('')}~${(h >>> 0).toString(16).padStart(8, '0')}`
}

const headerSig = (header: readonly string[]) => header.map((h) => plainText(h).toLowerCase().replace(/\s+/g, ' ')).join('|')

function fromFence(b: FenceBlock): Found {
  if (b.language === 'whiteboard' || b.language === 'sheet') {
    let title: string | undefined
    let id = ''
    try {
      const doc = JSON.parse(b.body) as { title?: unknown; id?: unknown }
      if (doc && typeof doc === 'object') {
        if (typeof doc.title === 'string' && doc.title.trim()) title = doc.title.trim()
        if (typeof doc.id === 'string') id = doc.id.trim()
      }
    } catch {
      /* keep the artifact; viewer handles streaming / malformed JSON cleanly */
    }
    return {
      key: id ? `${b.language}:${id}` : '',
      counter: id ? undefined : b.language,
      kind: b.language,
      title: title ?? (b.language === 'whiteboard' ? 'Whiteboard' : 'Spreadsheet'),
      language: b.language,
      content: b.body,
      lines: b.lines,
    }
  }
  const markdown = b.language === 'markdown'
  const kind: ArtifactKind = markdown ? 'markdown' : 'code'
  const firstHeading = markdown ? /^#{1,6}\s+(.+)$/m.exec(b.body)?.[1] : undefined
  return {
    key: b.filename ?? '',
    counter: b.filename ? undefined : markdown ? 'markdown' : `code:${b.language || 'text'}`,
    kind,
    title: b.filename ?? (firstHeading ? plainText(firstHeading) : markdown ? 'Document' : b.language ? `${languageName(b.language)} code` : 'Code snippet'),
    language: b.language || undefined,
    content: b.body,
    lines: b.lines,
  }
}

function fromTable(b: TableBlock): Found {
  return {
    key: `table:${headerSig(b.header)}`,
    kind: 'table',
    title: b.label ?? `${plainText(b.header[0] ?? '') || 'Data'} table`,
    content: b.source,
    rows: b.rows.length,
    columns: b.header.map(plainText),
    label: b.label,
  }
}

function fromElement(el: Record<string, unknown>): Found | null {
  const type = str(el.type) ?? 'file'
  const kind = ELEMENT_KINDS[type] ?? 'file'
  const name = str(el.name)
  const url = str(el.url) ?? str(el.path)
  const content = kind === 'code' ? (str(el.content) ?? str(el.code)) : undefined
  if (!url && content === undefined) return null
  const base = url ? decodeURIComponentSafe(url.split(/[?#]/)[0].split('/').pop() ?? '') : ''
  const language = kind === 'code' ? resolveLang(str(el.language)) || (name ? langFromFilename(name) : '') : undefined
  return {
    key: name ? `file:${name}` : url ? `url:${url}` : '',
    counter: name || url ? undefined : kind,
    kind,
    title: name ?? str(el.alt) ?? (base && !base.startsWith('data:') ? base : kind === 'image' ? 'Image' : 'File'),
    url,
    mimeType: str(el.mimeType) ?? str(el.mime) ?? str(el.mime_type),
    content,
    language: language || undefined,
    lines: content !== undefined ? content.split('\n').length : undefined,
  }
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Everything one message shows, in order.

A2UI is a live surface, not an artifact. Those messages stay on the chat
surface and are not turned into canvas tabs.
*/
function scanMessage(m: DeriveMessage, opts: Required<DeriveOptions>): Found[] {
  const found: Found[] = []
  for (const p of m.parts) {
    if (p.type === 'text' && 'text' in p) {
      for (const b of scanMarkdown(p.text)) {
        const studio = b.type === 'fence' && (b.language === 'whiteboard' || b.language === 'sheet')
        if (b.type === 'fence' && (studio || b.lines >= opts.minLines)) found.push(fromFence(b))
        else if (b.type === 'table' && b.rows.length >= opts.minRows) found.push(fromTable(b))
      }
    } else if (p.type === 'data' && 'name' in p && p.name === 'element') {
      const data = (p.data && typeof p.data === 'object' ? p.data : {}) as Record<string, unknown>
      const f = fromElement(data)
      if (f) found.push(f)
    }
  }
  return found
}

// Messages are immutable (the chat store replaces a message when it changes),
// so a message's scan is kept until it changes: a streaming frame rescans
// only the live message.
const scans = new WeakMap<object, { opts: string; found: Found[] }>()

function scanCached(m: DeriveMessage, opts: Required<DeriveOptions>): Found[] {
  const key = `${opts.minLines}/${opts.minRows}`
  const hit = scans.get(m)
  if (hit && hit.opts === key) return hit.found
  const found = scanMessage(m, opts)
  scans.set(m, { opts: key, found })
  return found
}

interface KeyState {
  latest: DerivedArtifact
  label?: string
  first: string
  columns: Set<string>
}

/** An earlier table this one continues: same label, or same first column with nested column sets. */
function continuesTable(f: Found, keys: Map<string, KeyState>): string | undefined {
  if (keys.has(f.key)) return f.key
  const cols = (f.columns ?? []).map((c) => c.toLowerCase())
  const set = new Set(cols)
  let match: string | undefined
  for (const [key, s] of keys) {
    if (s.latest.kind !== 'table') continue
    const sameLabel = !!f.label && !!s.label && f.label.toLowerCase() === s.label.toLowerCase()
    const nested = cols[0] === s.first && ([...set].every((c) => s.columns.has(c)) || [...s.columns].every((c) => set.has(c)))
    if (sameLabel || nested) match = key // the most recent match wins
  }
  return match
}

/**
 * Every artifact in `messages` (oldest first), with versions. Only assistant
 * messages count. Deterministic: the same messages give the same keys,
 * titles and version numbers, live or reloaded from history.
 */
export function deriveArtifacts(messages: readonly DeriveMessage[], sessionId: string | null, options: DeriveOptions = {}): Derived {
  const opts: Required<DeriveOptions> = {
    minLines: Math.max(1, options.minLines ?? DEFAULT_MIN_LINES),
    minRows: Math.max(1, options.minRows ?? DEFAULT_MIN_ROWS),
  }
  const keys = new Map<string, KeyState>()
  const order: string[] = []
  const byKey = new Map<string, DerivedArtifact[]>()
  const counters = new Map<string, number>()
  const surfaces = new Map<string, unknown[]>()
  const mentions: Record<string, DerivedArtifact[]> = {}

  for (const m of messages) {
    if (m.role !== 'assistant') continue
    const shown: DerivedArtifact[] = []
    for (const found of scanCached(m, opts)) {
      let f = found
      if (f.a2ui) {
        const all = [...(surfaces.get(f.key) ?? []), ...f.a2ui]
        surfaces.set(f.key, all)
        f = { ...f, content: JSON.stringify(all) }
      }
      let key = f.key
      if (f.kind === 'table') key = continuesTable(f, keys) ?? f.key
      else if (!key && f.counter) {
        const n = (counters.get(f.counter) ?? 0) + 1
        counters.set(f.counter, n)
        key = `${f.counter}:${n}`
      }
      key = boundKey(key)
      const prev = keys.get(key)
      let v: DerivedArtifact
      if (prev && prev.latest.content === f.content && prev.latest.url === f.url) {
        v = prev.latest
      } else {
        v = {
          key,
          kind: f.kind,
          title: f.kind === 'table' && prev && !f.label ? prev.latest.title : f.title,
          version: (prev?.latest.version ?? 0) + 1,
          sessionId,
          messageId: m.id,
          updatedAt: m.completedAt ?? m.createdAt,
          ...(m.agentName ? { agent: m.agentName } : {}),
          ...(f.language ? { language: f.language } : {}),
          ...(f.content !== undefined ? { content: f.content } : {}),
          ...(f.url ? { url: f.url } : {}),
          ...(f.mimeType ? { mimeType: f.mimeType } : {}),
          ...(f.lines !== undefined ? { lines: f.lines } : {}),
          ...(f.rows !== undefined ? { rows: f.rows } : {}),
          ...(f.columns ? { columns: f.columns } : {}),
        }
        if (!prev) order.push(key)
        byKey.set(key, [...(byKey.get(key) ?? []), v])
        keys.set(key, {
          latest: v,
          label: f.label ?? prev?.label,
          first: (f.columns?.[0] ?? '').toLowerCase(),
          columns: new Set((f.columns ?? []).map((c) => c.toLowerCase())),
        })
      }
      const at = shown.findIndex((s) => s.key === key)
      if (at >= 0) shown[at] = v
      else shown.push(v)
    }
    if (shown.length) mentions[m.id] = shown
  }
  return { versions: order.flatMap((k) => byKey.get(k) ?? []), mentions }
}

/** Shown as a card with "Open in canvas" instead of inline (12+ lines, 6+ rows). */
export function isLarge(a: Pick<DerivedArtifact, 'kind' | 'lines' | 'rows'>): boolean {
  if (a.kind === 'table') return (a.rows ?? 0) >= COLLAPSE_ROWS
  if (a.kind === 'code' || a.kind === 'markdown') return (a.lines ?? 0) >= COLLAPSE_LINES
  return false
}
