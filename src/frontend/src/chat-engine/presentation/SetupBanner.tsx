/**
 * Above the composer in a layout, before the first message can fail: "Add an
 * API key to start · Open settings" when /api/provider/health says the
 * built-in provider has no model key (api_key: 'missing'), or the provider's
 * own words when it is not answering. Nothing while it is fine, unknown, or
 * the request fails. Fetched once per page view.
 */
import { useEffect, useState, type JSX } from 'react'
import { KeyRound, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { navigate } from '@/sdk/services'

export interface ProviderHealth {
  status?: string
  provider?: string
  detail?: string
  api_key?: string
}

let health: Promise<ProviderHealth | null> | null = null

export function loadProviderHealth(): Promise<ProviderHealth | null> {
  health ??= fetch('/api/provider/health', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<ProviderHealth>) : null))
    .catch(() => null)
  return health
}

/** Test hook. */
export function resetProviderHealthForTests(): void {
  health = null
}

/** What the banner says, or null for none. */
export function setupNotice(h: ProviderHealth | null): { kind: 'key' | 'down'; text: string } | null {
  if (!h) return null
  if (h.api_key === 'missing') return { kind: 'key', text: 'Add an API key to start chatting.' }
  const status = (h.status ?? '').toLowerCase()
  if (status && status !== 'ok' && status !== 'healthy' && status !== 'unknown') {
    const who = h.provider || 'The model provider'
    return { kind: 'down', text: `${who} is not answering${h.detail && h.detail !== status ? `: ${h.detail}` : '.'}` }
  }
  return null
}

export function SetupBanner(): JSX.Element | null {
  const [notice, setNotice] = useState<ReturnType<typeof setupNotice>>(null)
  useEffect(() => {
    let alive = true
    void loadProviderHealth().then((h) => alive && setNotice(setupNotice(h)))
    return () => {
      alive = false
    }
  }, [])
  if (!notice) return null
  const Icon = notice.kind === 'key' ? KeyRound : TriangleAlert
  return (
    <div
      role="status"
      data-chat-setup-banner={notice.kind}
      className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--ui-warning-line)] bg-warning-soft px-3 py-2 text-sm text-foreground"
    >
      <Icon aria-hidden className="size-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 break-words">{notice.text}</span>
      <Button type="button" variant="outline" size="sm" className="bg-card" onClick={() => navigate('config')}>
        Open settings
      </Button>
    </div>
  )
}
