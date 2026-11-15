/**
 * The chat's connection inside a layout: nothing while the live connection
 * is up (the frame shows "connected" where it names the agent), and a banner
 * above the composer once it has dropped, with Retry. The classic frame keeps
 * its header badge instead.
 *
 * Drawn by the presentation host (`Pinned`); it follows the shared chat
 * transport, which the chat page uses unless a test passes its own.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ConnectionStatus } from '../protocol'
import { chatTransport } from '../sessionsStore'
import type { AiuiTransport } from '../transports'

export interface BannerText {
  text: string
  /** Show Retry (not while a handshake is already under way). */
  retry: boolean
  busy: boolean
}

/**
 * What the banner says, or null for none. `wasDown`: the connection dropped
 * since the page opened (the first handshake shows nothing).
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests and sibling modules
export function bannerFor(status: ConnectionStatus | undefined, wasDown: boolean, httpFallback: boolean): BannerText | null {
  if (!status || status === 'open' || !wasDown) return null
  if (status === 'connecting') return { text: 'Reconnecting…', retry: false, busy: true }
  return httpFallback
    ? { text: 'Live connection lost. Messages still send, a little slower.', retry: true, busy: false }
    : { text: 'Disconnected. Trying again shortly.', retry: true, busy: false }
}

export function ConnectionBanner({ transport = chatTransport() }: { transport?: AiuiTransport }): JSX.Element | null {
  const [status, setStatus] = useState<ConnectionStatus | undefined>(transport.status)
  // A socket that was never asked for is 'closed' too: only a close after a
  // handshake started (it dropped, or could not open) counts as down.
  const [wasDown, setWasDown] = useState(false)
  const last = useRef(transport.status)
  useEffect(() => {
    return transport.onStatus?.((s) => {
      if (s === 'closed' && last.current !== 'closed') setWasDown(true)
      if (s === 'open') setWasDown(false)
      last.current = s
      setStatus(s)
    })
  }, [transport])
  const banner = bannerFor(status, wasDown, !!transport.httpFallback)
  if (!banner) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-chat-connection-banner={status}
      className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
    >
      {banner.busy ? <Spinner className="size-3.5 shrink-0" /> : <WifiOff aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 break-words">{banner.text}</span>
      {banner.retry && transport.reconnect && (
        <Button type="button" variant="outline" size="sm" onClick={() => transport.reconnect?.()}>
          <RefreshCw aria-hidden />
          Retry
        </Button>
      )}
    </div>
  )
}
