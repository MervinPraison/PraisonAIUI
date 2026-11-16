/**
 * Knowledge page data, pure (app-pages.test.tsx): rows from GET /api/knowledge
 * and POST /api/knowledge/search, the store status from GET
 * /api/knowledge/status in plain words, the sort and the marked snippets.
 */
import type { ListSort } from '@/components/page/ListDetail'
import { toMs, type Tone } from '../shared'

export interface KnowledgeRow {
  id: string
  name: string
  /** "Text", or the file's kind ("PDF", "Markdown"…). */
  type: string
  filename: string | null
  text: string
  bytes: number
  words: number
  added: number
  /** "Upload" or "Typed in". */
  source: string
  /** Search relevance 0..1, when the store reports one. */
  score: number | null
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const FILE_TYPES: Record<string, string> = { pdf: 'PDF', md: 'Markdown', markdown: 'Markdown', txt: 'Text file', csv: 'CSV', json: 'JSON', doc: 'Word', docx: 'Word', html: 'HTML' }

export function fileType(filename: string | null): string {
  if (!filename) return 'Text'
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase()
  return ext ? (FILE_TYPES[ext] ?? ext.toUpperCase()) : 'File'
}

/** `{ entries }` (list) or `{ results }` (search) → rows; entries without an id are dropped. */
export function knowledgeRows(body: unknown): KnowledgeRow[] {
  const b = obj(body)
  const list = Array.isArray(b.entries) ? b.entries : Array.isArray(b.results) ? b.results : []
  const enc = new TextEncoder()
  return list.flatMap((raw): KnowledgeRow[] => {
    const e = obj(raw)
    const id = str(e.id) ?? (typeof e.id === 'number' ? String(e.id) : null)
    if (!id) return []
    const meta = obj(e.metadata)
    const filename = str(meta.filename)
    // The upload fallback stores "[File: name]\n…": that line is not content.
    const text = (typeof e.text === 'string' ? e.text : '').replace(/^\[File: [^\]\n]*\]\n?/, '')
    const body = text.trim()
    const line = body.split('\n')[0].trim()
    return [
      {
        id,
        name: str(meta.title) ?? filename ?? (line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line || 'Untitled'),
        type: fileType(filename),
        filename,
        text,
        bytes: enc.encode(body).length,
        words: body ? body.split(/\s+/).length : 0,
        added: toMs(e.created_at),
        source: filename || /upload|file/.test(str(meta.source) ?? '') ? 'Upload' : 'Typed in',
        score: typeof e.score === 'number' && Number.isFinite(e.score) ? e.score : null,
      },
    ]
  })
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** A relevance score as a percentage, or null when there is none to show. */
export function relevance(score: number | null): number | null {
  return score == null || score < 0 ? null : Math.round(Math.min(score, 1) * 100)
}

const KEY: Record<string, (r: KnowledgeRow) => string | number> = {
  name: (r) => r.name.toLowerCase(),
  type: (r) => r.type.toLowerCase(),
  size: (r) => r.bytes,
  added: (r) => (Number.isFinite(r.added) ? r.added : 0),
}

export function sortRows(rows: readonly KnowledgeRow[], sort: ListSort): KnowledgeRow[] {
  const key = KEY[sort.key] ?? KEY.added
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : 0))
}

export interface Segment {
  text: string
  hit: boolean
}

const terms = (query: string) => [...new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 1))]

/** `text` split into segments, the query's words marked. */
export function marked(text: string, query: string): Segment[] {
  const ts = terms(query)
  if (!ts.length || !text) return text ? [{ text, hit: false }] : []
  const re = new RegExp(`(${ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).filter(Boolean).map((part) => ({ text: part, hit: ts.includes(part.toLowerCase()) }))
}

/** About `size` characters of `text` around the first match, its matches marked. */
export function snippet(text: string, query: string, size = 160): Segment[] {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = Math.min(...terms(query).map((t) => flat.toLowerCase().indexOf(t)).filter((i) => i >= 0), Number.POSITIVE_INFINITY)
  const start = Number.isFinite(at) ? Math.max(0, at - Math.floor(size / 3)) : 0
  let part = flat.slice(start, start + size)
  if (start > 0) part = `…${part.replace(/^\S*\s/, '')}`
  if (start + size < flat.length) part = `${part.replace(/\s\S*$/, '')}…`
  return marked(part, query)
}

export interface StoreStatus {
  store: string
  search: string
  tone: Tone
  label: string
  /** One plain sentence about the store, for its tooltip. */
  note: string
  warnings: string[]
}

/** GET /api/knowledge/status in words; the backend's class name never reaches the page. */
export function storeStatus(body: unknown, error?: string | null): StoreStatus {
  if (!body || typeof body !== 'object') return { store: '—', search: '—', tone: error ? 'bad' : 'idle', label: error ? 'Unavailable' : 'Checking', note: error ?? '', warnings: [] }
  const s = obj(body)
  const backend = str(s.backend) ?? ''
  const vector = /sdk/i.test(backend)
  const memory = /simple|memory/i.test(backend)
  const status = str(s.status) ?? 'ok'
  return {
    store: vector ? 'Vector store' : memory ? 'In memory' : 'Custom store',
    search: vector && obj(s.embedding).available !== false ? 'Semantic' : 'Keyword',
    tone: status === 'ok' ? 'ok' : status === 'degraded' ? 'warn' : 'bad',
    label: status === 'ok' ? 'Ready' : status === 'degraded' ? 'Limited' : 'Unavailable',
    note: vector ? 'Entries are embedded; agents find them by meaning.' : memory ? 'Entries live in memory until the server restarts; search matches words.' : 'A custom knowledge store.',
    warnings: Array.isArray(s.warnings) ? s.warnings.filter((w): w is string => typeof w === 'string' && !!w) : [],
  }
}

/** What the upload endpoint said about one file: null when it was indexed, else why not. */
export function uploadError(body: unknown): string | null {
  const b = obj(body)
  return b.knowledge_indexed === true ? null : (str(b.knowledge_error) ?? str(b.error) ?? 'The file was uploaded but could not be indexed.')
}
