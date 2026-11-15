import { useCallback, useState } from 'react'

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false // no window, or blocked storage
  }
}

/** A per-viewer on/off kept in localStorage (a convenience: blocked storage keeps it for the visit only). */
export function useStoredFlag(key: string): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState(() => read(key))
  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? next(prev) : next
        try {
          if (v) window.localStorage.setItem(key, '1')
          else window.localStorage.removeItem(key)
        } catch {
          // private mode or full storage
        }
        return v
      })
    },
    [key],
  )
  return [value, set]
}
