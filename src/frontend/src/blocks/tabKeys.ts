/**
 * Keyboard model of the `tabs` block's tab list (WAI-ARIA tabs pattern,
 * horizontal, automatic activation): ArrowLeft/ArrowRight move to the
 * previous/next tab and wrap, Home/End go to the first/last tab.
 * Returns the tab to activate, or null when the key is not handled.
 */
export function tabForKey(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count
    case 'ArrowLeft':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
