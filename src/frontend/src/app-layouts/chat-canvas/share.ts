import { notify } from '@/sdk/notify'

/** Copy the page's link (a chat's link carries ?session=). */
export async function copyLink(href = window.location.href): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(href)
    void notify('Link copied', { type: 'success' })
    return true
  } catch {
    void notify('Could not copy the link. Copy it from the address bar.', { type: 'error' })
    return false
  }
}
