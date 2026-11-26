/**
 * Lightweight header bell trigger for the Notification Center.
 *
 * Mounts only a `<Button>` + lucide `<Bell>` + polite live region on boot;
 * lazily loads `./NotificationPanel` (Radix Popover) on hover/focus/click so
 * zero popover code sits on the boot path (R10).
 */
import { lazy, Suspense, useEffect, useId, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { subscribeNotificationAnnouncements, useNotifications, type NotificationItem } from '@/sdk/notifications'
import { registerNotificationPanelOpener } from './notifications'

const loadPanel = () => import('./NotificationPanel')
const LazyNotificationPopover = lazy(loadPanel)

function announceForScreenReader(item: NotificationItem, setLiveText: (msg: string) => void): void {
  const parts = [item.title]
  if (item.description) parts.push(item.description)
  if (item.action) parts.push('Action available')
  const msg = parts.join('. ')
  const doc = typeof document !== 'undefined' ? (document as Document & { ariaNotify?: (text: string) => void }) : null
  if (doc && typeof doc.ariaNotify === 'function') {
    try {
      doc.ariaNotify(msg)
      return
    } catch {
      /* fall back to live region */
    }
  }
  setLiveText(msg)
}

export function NotificationBell() {
  const { totalUnreadCount } = useNotifications()
  const panelId = useId()
  const [activated, setActivated] = useState(false)
  const [open, setOpen] = useState(false)
  const [liveText, setLiveText] = useState('')

  useEffect(() => {
    return registerNotificationPanelOpener(() => {
      void loadPanel()
      setActivated(true)
      setOpen(true)
    })
  }, [])

  useEffect(() => {
    return subscribeNotificationAnnouncements((item) => {
      announceForScreenReader(item, setLiveText)
    })
  }, [])

  const preload = () => {
    void loadPanel()
  }

  const label = totalUnreadCount > 0 ? `Notifications, ${totalUnreadCount} unread` : 'Notifications'

  const trigger = (
    <Button
      variant="ghost"
      size="icon-sm"
      onPointerEnter={preload}
      onFocus={preload}
      onClick={
        !activated
          ? () => {
              setActivated(true)
              setOpen(true)
            }
          : undefined
      }
      aria-label={label}
      aria-expanded={open}
      aria-controls={activated ? panelId : undefined}
      data-aiui-notifications-bell=""
      data-unread-count={totalUnreadCount}
      className="relative text-muted-foreground hover:text-foreground"
    >
      <Bell aria-hidden="true" />
      {totalUnreadCount > 0 && (
        <span
          aria-hidden="true"
          data-numeric=""
          className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs leading-none font-semibold text-primary-foreground tabular-nums"
        >
          {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
        </span>
      )}
    </Button>
  )

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {liveText}
      </span>
      {activated ? (
        <Suspense fallback={trigger}>
          <LazyNotificationPopover open={open} onOpenChange={setOpen} trigger={trigger} panelId={panelId} />
        </Suspense>
      ) : (
        trigger
      )}
    </>
  )
}
