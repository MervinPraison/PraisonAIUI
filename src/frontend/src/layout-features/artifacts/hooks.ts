/**
 * React glue for the artifacts store: a session's snapshot, code runs, and
 * the Copy / Download / Share actions.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { notify } from '@/sdk/notify'
import { codeLanguages, codeRunAvailable, runCode, type CodeRunResult } from './api'
import { resolveLang, type DerivedArtifact } from './derive'
import { artifactsStore } from './feed'
import { copyText, downloadOf, shareUrl } from './format'
import type { SessionArtifacts } from './store'

export function useArtifacts(sessionId: string | null): SessionArtifacts {
  const feed = artifactsStore().session(sessionId)
  return useSyncExternalStore(feed.subscribe, feed.get, feed.get)
}

/** True when the server can run this language (the code-studio record is on and lists it). */
export function useCanRun(language: string | undefined): boolean {
  const lang = resolveLang(language)
  const [langs, setLangs] = useState<string[] | null>(null)
  const available = !!lang && codeRunAvailable()
  useEffect(() => {
    if (!available) return
    let live = true
    void codeLanguages().then((l) => live && setLangs(l))
    return () => {
      live = false
    }
  }, [available])
  return available && !!langs?.includes(lang)
}

export interface RunState {
  running: boolean
  result: (CodeRunResult & { at: number }) | null
  run(): void
}

/** One code run at a time per viewer; the result stays until the artifact changes. */
export function useRun(a: DerivedArtifact | null): RunState {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<(NonNullable<RunState['result']> & { id: string }) | null>(null)
  const id = a ? `${a.sessionId}|${a.key}|${a.version}` : ''
  const run = useCallback(() => {
    if (!a || running || a.content === undefined) return
    setRunning(true)
    void runCode(a.content, resolveLang(a.language) || 'python').then((r) => {
      setResult({ ...r, at: Date.now(), id })
      setRunning(false)
    })
  }, [a, id, running])
  return { running, result: result?.id === id ? result : null, run }
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export async function copyArtifact(a: DerivedArtifact): Promise<void> {
  const text = copyText(a)
  if (!text) return
  const ok = await writeClipboard(text)
  notify(ok ? 'Copied' : 'Could not copy: the browser blocked the clipboard', { type: ok ? 'success' : 'error' })
}

/** Saves the text as a Blob, or fetches a media URL that passed safeUrl (downloadOf); anything else does nothing. */
export function downloadArtifact(a: DerivedArtifact): void {
  const d = downloadOf(a)
  if (d.text === undefined && !d.url) return
  const link = document.createElement('a')
  let objectUrl: string | null = null
  if (d.text !== undefined) {
    objectUrl = URL.createObjectURL(new Blob([d.text], { type: `${d.mime};charset=utf-8` }))
    link.href = objectUrl
  } else {
    link.href = d.url!
    link.rel = 'noopener'
  }
  link.download = d.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export async function shareArtifact(a: DerivedArtifact): Promise<void> {
  if (!a.sessionId) {
    notify('Send a message first: a new chat has no link yet', { type: 'info' })
    return
  }
  const ok = await writeClipboard(shareUrl(a, window.location.origin))
  notify(ok ? 'Link copied. Anyone who can open this chat can open it.' : 'Could not copy the link', { type: ok ? 'success' : 'error' })
}
