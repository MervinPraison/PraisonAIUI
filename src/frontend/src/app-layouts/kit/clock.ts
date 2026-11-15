import { useSyncExternalStore } from 'react'

/**
 * A clock for relative times ("2h"): the time now, refreshed once a minute
 * while anything reads it. One shared timer, stopped when the last reader
 * unmounts, so a frame leaves no interval behind.
 */
const MINUTE = 60_000
const readers = new Set<() => void>()
let now = 0
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(fn: () => void): () => void {
  readers.add(fn)
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now()
      for (const r of readers) r()
    }, MINUTE)
  }
  return () => {
    readers.delete(fn)
    if (readers.size === 0 && timer) {
      clearInterval(timer)
      timer = undefined
      now = 0
    }
  }
}

function read(): number {
  // Stable between ticks (useSyncExternalStore needs that); the first read
  // after the clock stopped starts again from the real time.
  if (!now) now = Date.now()
  return now
}

export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, read, read)
}
