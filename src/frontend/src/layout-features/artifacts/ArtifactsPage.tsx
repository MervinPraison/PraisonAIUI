/**
 * The `artifacts` page (owned by the `builtin.artifacts` record, shown in
 * the chat-canvas nav): every chat's artifacts, newest first, searchable,
 * grouped by chat; one opens in full with its versions. Share links land
 * here (`/artifacts?session=…&artifact=…&v=…`).
 *
 * The list comes from the server index while the record is on; without it
 * (client only) it lists the chats this tab has seen. Opening an artifact
 * reads the open chat when it is that one, else the versions the server
 * stored for that chat.
 *
 *   registerPage('artifacts', () => import('@/layout-features/artifacts/ArtifactsPage'))
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type JSX } from 'react'
import { ArrowLeft, Layers, MessageSquare, RefreshCw, Search } from 'lucide-react'
import type { ShellPage } from '@/sdk/manifest'
import type { SessionsFeed, SessionsState } from '@/sdk/layoutTypes'
import { useLayoutData } from '@/sdk/layouts'
import { navigate } from '@/sdk/services'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { artifactsServerEnabled, fetchArtifactIndex } from './api'
import type { DerivedArtifact } from './derive'
import { artifactsStore } from './feed'
import { cardMeta, parseShareQuery, relativeTime, shareUrl } from './format'
import { useArtifacts } from './hooks'
import { measure } from './store'
import { ArtifactView } from './ArtifactView'
import { KindIcon } from './viewers/Viewer'
import './artifacts.css'

interface Target {
  sessionId: string
  key: string
  version?: number
}

const EMPTY_SESSIONS: SessionsState = { sessions: [], activeId: null, runningIds: new Set(), loading: false }
const noFeed = () => () => undefined

function useSessionTitles(): Map<string, string> {
  const feed = useLayoutData('sessions') as SessionsFeed | null
  const state = useSyncExternalStore(feed?.subscribe ?? noFeed, () => feed?.get() ?? EMPTY_SESSIONS, () => EMPTY_SESSIONS)
  return useMemo(() => new Map(state.sessions.map((s) => [s.id, s.title])), [state.sessions])
}

function setQuery(t: Target | null) {
  const url = t ? shareUrl({ sessionId: t.sessionId, key: t.key, version: t.version ?? 0 }, '').replace(/&v=0$/, '') : window.location.pathname
  try {
    window.history.replaceState(window.history.state, '', url)
  } catch {
    /* sandboxed frames */
  }
}

function localRows(): DerivedArtifact[] {
  const store = artifactsStore()
  return store.knownSessions().flatMap((sid) => store.session(sid).get().latest)
}

function useIndex(): { rows: DerivedArtifact[]; loading: boolean; error: string | null; server: boolean; refresh(): void } {
  const server = artifactsServerEnabled()
  const [n, setN] = useState(0)
  // The chats open in this tab: newer than the index can be.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `n` is the refresh request
  const local = useMemo(() => localRows(), [n])
  const [fetched, setFetched] = useState<{ n: number; rows: DerivedArtifact[]; error: string | null } | null>(null)
  useEffect(() => {
    if (!server) return
    let live = true
    fetchArtifactIndex({ limit: 500 }).then(
      (idx) => live && setFetched({ n, rows: idx.artifacts.map(measure), error: null }),
      (err: unknown) => live && setFetched({ n, rows: [], error: err instanceof Error ? err.message : 'The list could not be loaded' }),
    )
    return () => {
      live = false
    }
  }, [server, n])
  const rows = useMemo(() => {
    const seen = new Set(local.map((a) => `${a.sessionId}\n${a.key}`))
    return [...local, ...(fetched?.rows ?? []).filter((a) => !seen.has(`${a.sessionId}\n${a.key}`))]
  }, [local, fetched])
  return { rows, loading: server && fetched?.n !== n, error: fetched?.error ?? null, server, refresh: () => setN((x) => x + 1) }
}

function Detail({ target, title, onBack }: { target: Target; title?: string; onBack(): void }): JSX.Element {
  const store = artifactsStore()
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState<number | undefined>(target.version)
  useEffect(() => {
    let live = true
    store.ensure(target.sessionId).finally(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [store, target.sessionId])
  const loading = !loaded
  const snap = useArtifacts(target.sessionId)
  const versions = snap.versions.filter((v) => v.key === target.key)
  const shown = (version !== undefined ? versions.find((v) => v.version === version) : undefined) ?? versions[versions.length - 1]
  const show = (v: number | undefined) => {
    setVersion(v)
    setQuery({ ...target, version: v })
  }
  const sessions = useLayoutData('sessions')
  const openChat = () => {
    if (sessions) sessions.select(target.sessionId)
    else {
      navigate('chat')
      window.dispatchEvent(new CustomEvent('aiui:session-select', { detail: { sessionId: target.sessionId } }))
    }
  }
  return (
    <div className="flex flex-col gap-2" data-artifacts-page="">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          All artifacts
        </Button>
        <span className="min-w-0 truncate text-sm text-tier-3">{title ?? 'Chat'}</span>
        <Button variant="outline" className="ml-auto" onClick={openChat}>
          <MessageSquare />
          Open the chat
        </Button>
      </div>
      <div className="rounded-xl border border-hairline bg-card shadow-sm">
        {shown ? (
          <ArtifactView
            artifact={shown}
            versions={versions}
            onShow={(v) => show(v)}
            onRestore={(v) => {
              store.restore(target.sessionId, target.key, v)
              show(undefined)
            }}
          />
        ) : (
          <p className="m-0 px-5 py-8 text-sm text-tier-3" aria-live="polite">
            {loading ? 'Loading…' : 'This artifact is not available here. Open the chat to see it.'}
          </p>
        )}
      </div>
    </div>
  )
}

export default function ArtifactsPage({ page }: { page?: ShellPage }): JSX.Element {
  const [target, setTarget] = useState<Target | null>(() => (typeof window === 'undefined' ? null : parseShareQuery(window.location.search)))
  const [q, setQ] = useState('')
  const titles = useSessionTitles()
  const index = useIndex()

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = needle ? index.rows.filter((a) => a.title.toLowerCase().includes(needle) || (titles.get(a.sessionId ?? '') ?? '').toLowerCase().includes(needle)) : index.rows
    const by = new Map<string, DerivedArtifact[]>()
    for (const a of [...rows].sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0))) {
      const sid = a.sessionId ?? ''
      if (!by.has(sid)) by.set(sid, [])
      by.get(sid)!.push(a)
    }
    return [...by.entries()]
  }, [index.rows, q, titles])

  const open = (a: DerivedArtifact) => {
    if (!a.sessionId) return
    const t = { sessionId: a.sessionId, key: a.key }
    setQuery(t)
    setTarget(t)
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6" data-artifacts-page="">
      {target ? (
        <Detail
          key={`${target.sessionId}\n${target.key}`}
          target={target}
          title={titles.get(target.sessionId)}
          onBack={() => {
            setQuery(null)
            setTarget(null)
            index.refresh()
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-xl font-semibold tracking-tight">{page?.title ?? 'Artifacts'}</h1>
              <p className="m-0 text-sm text-tier-3">
                {index.server ? 'Tables, code and files from every chat.' : 'Tables, code and files from the chats opened in this tab.'}
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-tier-3" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search artifacts" aria-label="Search artifacts" className="pl-8" />
            </div>
            <Button variant="ghost" size="icon" aria-label="Refresh" onClick={index.refresh}>
              <RefreshCw />
            </Button>
          </div>
          {index.error && <p className="m-0 text-sm text-destructive">{index.error}</p>}
          {index.loading ? (
            <p className="m-0 text-sm text-tier-3">Loading…</p>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <Layers className="size-6 text-tier-3" aria-hidden />
              <p className="m-0 font-semibold">{q ? 'Nothing matches' : 'No artifacts yet'}</p>
              <p className="m-0 max-w-sm text-sm text-tier-3">When an agent writes a table, code or a file in a chat, it shows up here.</p>
            </div>
          ) : (
            groups.map(([sid, items]) => (
              <section key={sid} aria-label={titles.get(sid) ?? 'Chat'} className="flex flex-col gap-1.5">
                <h2 className="m-0 truncate text-sm font-semibold text-tier-2">{titles.get(sid) ?? 'Chat'}</h2>
                <ul className="m-0 flex list-none flex-col divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-card p-0">
                  {items.map((a) => (
                    <li key={a.key}>
                      <a
                        href={shareUrl(a, '')}
                        onClick={(e) => {
                          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                          e.preventDefault()
                          open(a)
                        }}
                        className="flex min-h-11 items-center gap-3 px-3 py-2 text-foreground no-underline outline-none hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      >
                        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar text-link">
                          <KindIcon kind={a.kind} className="size-4" />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-semibold">{a.title}</span>
                          <span className="truncate text-xs text-tier-3">{cardMeta(a, { compact: true })}</span>
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-tier-3 tabular-nums">{relativeTime(a.updatedAt)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}
