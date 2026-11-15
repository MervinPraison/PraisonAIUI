/**
 * Client for the artifacts feature (`features/artifacts.py`, record
 * `builtin.artifacts`) and for code runs (`features/code_execution.py`,
 * record `builtin.code-studio`). Every call goes through the SDK's
 * fetchJson, so it carries the gateway token.
 *
 *   GET    /api/artifacts?session_id=&limit=      latest version of every key, no content
 *   GET    /api/artifacts/{session_id}            every version, with content
 *   PUT    /api/artifacts/{session_id}/{key}      upsert a derived version, or add an edit
 *   DELETE /api/artifacts/{session_id}/{key}[?version=N]
 *   POST   /api/code/execute                      {code, language} → {status, output, error}
 *   GET    /api/code/languages
 *
 * The server only stores: the rules that find artifacts are in ./derive.
 * With the record off (no chat-canvas layout, or switched off) nothing here
 * is called and the canvas works from the chat alone.
 */
import type { Artifact, ArtifactKind } from '@/sdk/layoutTypes'
import type { ShellManifest } from '@/sdk/manifest'
import { fetchJson, getManifest } from '@/sdk/services'

export const ARTIFACTS_RECORD = 'builtin.artifacts'
export const CODE_RECORD = 'builtin.code-studio'
/** The pages those records own. */
export const ARTIFACTS_PAGE = 'artifacts'
export const CODE_PAGE = 'code-studio'
/** The server's `KINDS`. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['code', 'table', 'markdown', 'file', 'image', 'pdf', 'video', 'a2ui']
/** The server's limits (`MAX_CONTENT`, `_TEXT_LIMITS`): larger values are left out of a PUT. */
export const MAX_CONTENT_BYTES = 512 * 1024
const LIMITS = { title: 300, messageId: 200, language: 64, mimeType: 128, url: 4096 } as const

/**
 * Whether a built-in record is on. The shell manifest's `plugins` lists
 * third-party records only, so a built-in shows through the page it owns
 * (a record's pages are in the manifest exactly while it is on); a record
 * listed with status `ok` counts too.
 */
const recordOn = (name: string, pageId: string, manifest: ShellManifest | null) =>
  !!manifest && (manifest.pages?.some((p) => p.id === pageId) || !!manifest.plugins?.some((p) => p.name === name && p.status === 'ok'))

/** True when the server stores artifacts (`builtin.artifacts` is on: its `artifacts` page is listed). */
export function artifactsServerEnabled(manifest: ShellManifest | null = getManifest()): boolean {
  return recordOn(ARTIFACTS_RECORD, ARTIFACTS_PAGE, manifest)
}

/**
 * True when the manifest lists the `artifacts` page, so a share link
 * (`/artifacts?session=…`) opens something. Without it Share is hidden and a
 * card is a button, not a link: the link would land on "Page not found".
 */
export function artifactsPageListed(manifest: ShellManifest | null = getManifest()): boolean {
  return !!manifest?.pages?.some((p) => p.id === ARTIFACTS_PAGE)
}

/** True when the server can run code (`builtin.code-studio` is on: its `code-studio` page is listed). */
export function codeRunAvailable(manifest: ShellManifest | null = getManifest()): boolean {
  return recordOn(CODE_RECORD, CODE_PAGE, manifest)
}

const seg = (s: string) => encodeURIComponent(s)

export interface ArtifactIndex {
  artifacts: Artifact[]
  /** Keys across the sessions asked for. */
  count: number
  sessions: number
}

export async function fetchArtifactIndex(opts: { sessionId?: string; limit?: number } = {}): Promise<ArtifactIndex> {
  const q = new URLSearchParams()
  if (opts.sessionId) q.set('session_id', opts.sessionId)
  if (opts.limit) q.set('limit', String(opts.limit))
  const qs = q.toString()
  const data = await fetchJson<Partial<ArtifactIndex>>(`/api/artifacts${qs ? `?${qs}` : ''}`)
  return { artifacts: Array.isArray(data?.artifacts) ? data.artifacts : [], count: data?.count ?? 0, sessions: data?.sessions ?? 0 }
}

export async function fetchSessionArtifacts(sessionId: string): Promise<Artifact[]> {
  const data = await fetchJson<{ artifacts?: Artifact[] }>(`/api/artifacts/${seg(sessionId)}`)
  return Array.isArray(data?.artifacts) ? data.artifacts : []
}

export type ArtifactPut = Pick<Artifact, 'kind'> & Partial<Pick<Artifact, 'title' | 'version' | 'messageId' | 'language' | 'content' | 'url' | 'mimeType' | 'edited'>>

/**
 * The PUT body for a version: only the fields the server takes, each within
 * its limit (a value over a limit is dropped rather than failing the PUT).
 * `withContent` false leaves the text out (an index-only upsert).
 */
export function putBody(a: ArtifactPut, withContent: boolean): ArtifactPut {
  const out: ArtifactPut = { kind: a.kind }
  for (const k of ['title', 'messageId', 'language', 'mimeType', 'url'] as const) {
    const v = a[k]
    if (typeof v === 'string' && v && v.length <= LIMITS[k]) out[k] = v
  }
  if (a.edited) out.edited = true
  else if (typeof a.version === 'number' && a.version >= 1) out.version = a.version
  if (withContent && typeof a.content === 'string' && new TextEncoder().encode(a.content).length <= MAX_CONTENT_BYTES) {
    out.content = a.content
  }
  return out
}

/** Upsert a derived version (with its `version`) or add a user version (`edited: true`). */
export async function putArtifact(sessionId: string, key: string, body: ArtifactPut): Promise<Artifact> {
  const data = await fetchJson<{ artifact: Artifact }>(`/api/artifacts/${seg(sessionId)}/${seg(key)}`, { method: 'PUT', body })
  return data.artifact
}

/** Delete one key (every version, or one), or the whole session's artifacts (no key). */
export async function deleteArtifacts(sessionId: string, key?: string, version?: number): Promise<number> {
  const url = key
    ? `/api/artifacts/${seg(sessionId)}/${seg(key)}${version ? `?version=${version}` : ''}`
    : `/api/artifacts/${seg(sessionId)}`
  const data = await fetchJson<{ deleted?: number }>(url, { method: 'DELETE' })
  return data?.deleted ?? 0
}

// ── code runs ────────────────────────────────────────────────────────

export interface CodeRunResult {
  status: 'success' | 'failed' | 'error' | 'denied' | 'degraded' | string
  output?: string
  error?: string
  /** Client-measured wall time, ms. */
  durationMs: number
}

/**
 * Run code on the server. The server asks for approval first (the run waits
 * until someone decides), so this can take a while; a denial or an error
 * resolves with that status rather than throwing.
 */
export async function runCode(code: string, language: string): Promise<CodeRunResult> {
  const t0 = Date.now()
  try {
    const r = await fetchJson<Record<string, unknown>>('/api/code/execute', { body: { code, language } })
    return {
      status: typeof r.status === 'string' ? r.status : 'success',
      output: typeof r.output === 'string' ? r.output : undefined,
      error: typeof r.error === 'string' && r.error ? r.error : undefined,
      durationMs: Date.now() - t0,
    }
  } catch (err) {
    const body = (err as { body?: unknown }).body as Record<string, unknown> | undefined
    return {
      status: typeof body?.status === 'string' ? body.status : 'error',
      error: typeof body?.error === 'string' ? body.error : err instanceof Error ? err.message : 'The run failed',
      durationMs: Date.now() - t0,
    }
  }
}

let languages: Promise<string[]> | null = null

/** Language ids the server says it runs (cached; [] when the call fails). */
export function codeLanguages(): Promise<string[]> {
  languages ??= fetchJson<{ languages?: { id?: string }[] }>('/api/code/languages').then(
    (d) => (d?.languages ?? []).map((l) => l.id).filter((id): id is string => typeof id === 'string'),
    () => {
      languages = null
      return []
    },
  )
  return languages
}

/** Tests only. */
export function resetApiCachesForTests(): void {
  languages = null
}
