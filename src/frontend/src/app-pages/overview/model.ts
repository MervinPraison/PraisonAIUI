/** Overview page data, pure (overview.test.ts). */

/** "Good morning" / "Good afternoon" / "Good evening" by the local hour. */
export function greeting(now: Date): string {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/**
 * One plain sentence about what waits and what runs; with nothing running or
 * waiting, what still needs a look (no model key, unhealthy features) before
 * "Everything is quiet".
 */
export function summary(p: { waiting: number; running: number; agentWaiting?: string; attention?: number; keyMissing?: boolean }): string {
  const parts: string[] = []
  if (p.running) parts.push(`${p.running} ${p.running === 1 ? 'run is' : 'runs are'} working`)
  if (p.waiting) {
    parts.push(
      p.agentWaiting && p.waiting === 1
        ? `${p.agentWaiting} needs your approval`
        : `${p.waiting} ${p.waiting === 1 ? 'approval waits' : 'approvals wait'} for you`,
    )
  }
  if (!parts.length) {
    if (p.keyMissing) return 'Add an API key in Settings to start chatting.'
    if (p.attention) return `${p.attention === 1 ? '1 thing needs' : `${p.attention} things need`} a look: see Feature health.`
    return 'Everything is quiet. Start a chat or pick up where you left off.'
  }
  const text = `${parts.join(', and ')}.`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "1 needs attention", "3 need attention". */
export function attentionLabel(n: number): string {
  return `${n} ${n === 1 ? 'needs' : 'need'} attention`
}

/** The provider card's line: connected, not configured (no model key), or the provider's own words. */
export function providerLine(h: { status?: string; detail?: string; api_key?: string } | null | undefined, error?: string | null): { tone: 'ok' | 'warn'; text: string; addKey?: boolean } {
  if (h?.api_key === 'missing') return { tone: 'warn', text: 'Not configured', addKey: true }
  if (/^(ok|healthy)$/i.test(h?.status ?? '')) return { tone: 'ok', text: 'Connected' }
  return { tone: 'warn', text: h?.detail || error || 'Not reachable' }
}

/** One value per hour of /api/usage/timeseries (oldest first). */
export function series(body: unknown, key: 'tokens' | 'requests' | 'cost' = 'tokens'): number[] {
  const list = body && typeof body === 'object' ? (body as { timeseries?: unknown }).timeseries : null
  if (!Array.isArray(list)) return []
  return list.map((p) => {
    const v = p && typeof p === 'object' ? (p as Record<string, unknown>)[key] : 0
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  })
}

/** SVG polyline points for a sparkline in a w×h box; '' with fewer than 2 points or a flat line. */
export function sparkPath(values: readonly number[], w: number, h: number): string {
  if (values.length < 2) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  if (max === min) return ''
  const step = w / (values.length - 1)
  return values.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - ((v - min) / (max - min)) * (h - 2)).toFixed(1)}`).join(' ')
}

export function formatCost(usd: number | undefined): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return '—'
  return usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

export function formatCount(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—'
}

export function formatMs(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export interface FeatureHealth {
  name: string
  status: string
  ok: boolean
}

/** /api/features → each feature's health, the unhealthy ones first. */
export function featureHealth(body: unknown): FeatureHealth[] {
  const list = body && typeof body === 'object' ? (body as { features?: unknown }).features : null
  if (!Array.isArray(list)) return []
  return list
    .flatMap((f) => {
      if (!f || typeof f !== 'object') return []
      const r = f as { name?: unknown; health?: { status?: unknown } }
      if (typeof r.name !== 'string') return []
      const status = typeof r.health?.status === 'string' ? r.health.status : 'unknown'
      return [{ name: r.name, status, ok: /^(ok|healthy|ready)$/i.test(status) }]
    })
    .sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name))
}
