import { useSyncExternalStore } from 'react'

function subscribe(fn: () => void): () => void {
  window.addEventListener('online', fn)
  window.addEventListener('offline', fn)
  return () => {
    window.removeEventListener('online', fn)
    window.removeEventListener('offline', fn)
  }
}

const readOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)
const serverOnline = () => true

/** True unless the browser reports it is offline. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, readOnline, serverOnline)
}
