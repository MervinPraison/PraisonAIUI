/** Relative timestamp formatting for the lazy-loaded Notification Panel. */
export function formatRelativeTime(createdAt: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - createdAt) / 1000))
  if (diffSec < 45) return 'Just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  try {
    return new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return `${diffDay}d ago`
  }
}
