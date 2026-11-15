/**
 * Where a pinned approval gate renders: one element above the composer
 * (host `Pinned`), shared with every open gate of the thread (host `Gate`).
 * The chat page shows one thread at a time, so one slot is enough. Pure
 * state, no DOM of its own (presentation.test.ts).
 */
import { useSyncExternalStore } from 'react'
import type { ChatPresentation } from '@/sdk/layouts'

let slot: HTMLElement | null = null
const listeners = new Set<() => void>()

/** True when this presentation pins open gates above the composer: the 'steps' thread, whose turn header owns the steps. */
export function pinsGates(chat: Pick<ChatPresentation, 'thread'>): boolean {
  return chat.thread === 'steps'
}

const emit = () => {
  for (const fn of listeners) fn()
}

/**
 * The slot element's ref callback. Its cleanup lets go only of that element,
 * so a slot that replaced it (another thread mounted first) stays.
 */
export function pinnedSlotRef(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return undefined
  slot = el
  emit()
  return () => {
    if (slot !== el) return
    slot = null
    emit()
  }
}

export function getPinnedSlot(): HTMLElement | null {
  return slot
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const none = () => null

/** The current slot, re-rendering when it mounts or goes. */
export function usePinnedSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getPinnedSlot, none)
}
