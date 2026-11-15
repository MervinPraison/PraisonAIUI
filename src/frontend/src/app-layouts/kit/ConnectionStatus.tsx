/**
 * The sidebar footer's connection line (Pro: a green dot and "Connected").
 * It follows the browser's network state (online / offline events); a chat
 * whose socket drops says so in the thread itself.
 */
import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'

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

export function ConnectionStatus({ className, detail }: { className?: string; detail?: string }) {
  const online = useOnline()
  return (
    <span role="status" data-aiui-connection={online ? 'online' : 'offline'} className={cn('flex min-w-0 items-center gap-2 text-xs text-muted-foreground', className)}>
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', online ? 'bg-success' : 'bg-warning')} />
      <span className="truncate">
        {online ? 'Connected' : 'Offline'}
        {detail && <span className="text-tier-3"> · {detail}</span>}
      </span>
    </span>
  )
}
