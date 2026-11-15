/**
 * What every layout region of the chat gets (ChatRegionProps): the open
 * session, the shell's viewport class, and reportBadge(), whose count the
 * aside's phone switch and toggle show. Module state, so the regions inside
 * the Thread and the aside beside it share one badge.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { layoutViewport, type ChatRegionProps, type LayoutViewport } from '@/sdk/layouts'

function subscribeResize(fn: () => void) {
  window.addEventListener('resize', fn)
  return () => window.removeEventListener('resize', fn)
}
// Without a window (or a width) it is a desktop.
const readViewport = (): LayoutViewport => layoutViewport(typeof window === 'undefined' ? Infinity : window.innerWidth ?? Infinity)

/** phone < 768 px, tablet < 1024 px, else desktop (the shell's classes). */
export function useViewport(): LayoutViewport {
  return useSyncExternalStore(subscribeResize, readViewport, readViewport)
}

let badge = 0
const badgeListeners = new Set<() => void>()

/** A region's count for the aside's tab (0 hides it). Non-numbers and negatives count as 0. */
export function reportBadge(n: number): void {
  const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  if (next === badge) return
  badge = next
  for (const fn of [...badgeListeners]) fn()
}

function subscribeBadge(fn: () => void) {
  badgeListeners.add(fn)
  return () => {
    badgeListeners.delete(fn)
  }
}
const readBadge = () => badge

export function useBadge(): number {
  return useSyncExternalStore(subscribeBadge, readBadge, readBadge)
}

/** The props of a chat region for this session (stable until the session or viewport changes). */
export function useRegionProps(sessionId: string | null): ChatRegionProps {
  const viewport = useViewport()
  return useMemo(() => ({ sessionId, viewport, reportBadge }), [sessionId, viewport])
}
