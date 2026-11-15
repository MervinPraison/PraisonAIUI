/**
 * The composer's "Enter to send · Shift + Enter for a new line" hint inside a
 * layout is for a first-time user: after three sends in this browser it is
 * never shown again (composer.css hides it on data-composer-hint="off"; until
 * then it shows only while the composer is focused and empty).
 *
 * A send is a live turn starting: the thread's user messages grow by one
 * while it runs or with a user message last (a history load does neither).
 * The count is a per-viewer convenience in localStorage; without storage the
 * hint simply keeps its focused-and-empty rule.
 */
import { useEffect, useRef } from 'react'
import { useAuiState } from '@assistant-ui/react'

export const HINT_KEY = 'aiui-composer-sends'
export const HINT_SENDS = 3

export function readSends(): number {
  try {
    const n = Number(localStorage.getItem(HINT_KEY))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** Count one send; returns the new total. */
export function noteSend(): number {
  const n = readSends() + 1
  try {
    localStorage.setItem(HINT_KEY, String(n))
  } catch {
    /* per-viewer convenience only */
  }
  return n
}

export const hintOff = (sends: number) => sends >= HINT_SENDS

/** True when the user-message count moved from `prev` to `next` by one live send. */
export function isLiveSend(prev: number, next: number, running: boolean, lastIsUser = false): boolean {
  return next === prev + 1 && (running || lastIsUser)
}

function threadRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-aiui-thread]')?.closest<HTMLElement>('[data-variant]') ?? null
}

/** Mounted once per layout thread (host `Pinned`): marks the thread when the hint has had its three sends. */
export function useComposerHint(): void {
  const users = useAuiState((s) => s.thread.messages.filter((m) => m.role === 'user').length)
  const running = useAuiState((s) => s.thread.isRunning)
  const lastIsUser = useAuiState((s) => s.thread.messages.at(-1)?.role === 'user')
  const prev = useRef(users)
  useEffect(() => {
    const sent = isLiveSend(prev.current, users, running, lastIsUser)
    prev.current = users
    const total = sent ? noteSend() : readSends()
    if (hintOff(total)) threadRoot()?.setAttribute('data-composer-hint', 'off')
  }, [users, running, lastIsUser])
}
