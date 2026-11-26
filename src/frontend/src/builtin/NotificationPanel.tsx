/**
 * Lazy-loaded Notification Center popover panel.
 *
 * Loaded on first hover/focus/click of the header bell trigger so Radix Popover
 * and panel UI never enter the shell's boot closure (R10).
 * Tokens and primitives only (R14 / DESIGN.md).
 */
import { useId, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  Info,
  Trash2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { isSafeNotificationHref, useNotifications, type NotificationItem, type NotificationType } from '@/sdk/notifications'
import { navigate } from '@/sdk/services'
import { formatRelativeTime } from './notificationTime'

export interface NotificationPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  panelId: string
}

function TypeIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case 'success':
      return <CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--success)' }} aria-hidden="true" />
    case 'warning':
      return <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warning)' }} aria-hidden="true" />
    case 'error':
      return <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
    case 'info':
      return <Info className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--info)' }} aria-hidden="true" />
    default:
      return <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  }
}

function NotificationRow({
  item,
  onMarkRead,
  onMarkUnread,
  onRemove,
  onClosePanel,
}: {
  item: NotificationItem
  onMarkRead: (id: string) => void
  onMarkUnread: (id: string) => void
  onRemove: (id: string) => void
  onClosePanel: () => void
}) {
  const iso = useMemo(() => {
    try {
      return new Date(item.createdAt).toISOString()
    } catch {
      return ''
    }
  }, [item.createdAt])

  const runAction = () => {
    const action = item.action
    if (!action) return
    onMarkRead(item.id)
    if (action.onClick) {
      action.onClick()
      onClosePanel()
      return
    }
    if (action.page) {
      navigate(action.page, action.params ? { params: action.params } : undefined)
      onClosePanel()
      return
    }
    if (isSafeNotificationHref(action.href)) {
      if (action.href.startsWith('/')) {
        window.location.assign(action.href)
      } else {
        window.open(action.href, '_blank', 'noopener,noreferrer')
      }
      onClosePanel()
    }
  }

  return (
    <li
      data-aiui-notification-id={item.id}
      data-unread={item.read ? undefined : 'true'}
      className={cn(
        'group flex items-start gap-2.5 border-b border-hairline px-3 py-2.5 last:border-b-0 hover:bg-row-hover',
        !item.read && 'bg-accent-soft',
      )}
    >
      <TypeIcon type={item.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn('min-w-0 break-words text-sm leading-snug', item.read ? 'font-normal text-tier-2' : 'font-medium text-tier-1')}>
            {!item.read && (
              <span
                className="mr-1.5 inline-block size-1.5 rounded-full bg-primary align-middle"
                aria-hidden="true"
              />
            )}
            {item.title}
          </p>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => (item.read ? onMarkUnread(item.id) : onMarkRead(item.id))}
              aria-label={item.read ? `Mark "${item.title}" as unread` : `Mark "${item.title}" as read`}
              className="text-muted-foreground opacity-80 hover:text-foreground hover:opacity-100"
            >
              <Check />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onRemove(item.id)}
              aria-label={`Dismiss "${item.title}"`}
              className="text-muted-foreground opacity-80 hover:text-foreground hover:opacity-100"
            >
              <X />
            </Button>
          </div>
        </div>
        {item.description && (
          <p className="mt-0.5 break-words text-xs leading-relaxed text-tier-3">{item.description}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-tier-3">
          <time dateTime={iso}>{formatRelativeTime(item.createdAt)}</time>
          {item.category && (
            <Badge variant="secondary" className="text-2xs font-normal">
              {item.category}
            </Badge>
          )}
          {item.action && (
            <Button
              variant="link"
              size="xs"
              onClick={runAction}
              className="h-auto p-0 text-xs font-medium text-link"
            >
              <span>{item.action.label}</span>
              {item.action.href && !item.action.page && !item.action.href.startsWith('/') ? (
                <ExternalLink className="size-3" aria-hidden="true" />
              ) : (
                <ArrowUpRight className="size-3" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

export function NotificationPanelBody({ onClose }: { onClose: () => void }) {
  const headingId = useId()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined)
  const { items, totalUnreadCount, categories, markRead, markUnread, markAllRead, remove, clear } = useNotifications({
    unreadOnly,
    category: selectedCategory,
  })
  const hasAny = totalUnreadCount > 0 || items.length > 0 || Boolean(selectedCategory) || unreadOnly

  return (
    <div
      role="region"
      aria-labelledby={headingId}
      className="flex flex-col"
      style={{ maxHeight: 'min(32rem, calc(100dvh - 5rem))' }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={headingId} className="truncate text-sm font-semibold text-tier-1">
            Notifications
          </h2>
          {totalUnreadCount > 0 && (
            <Badge variant="secondary" data-numeric="" className="tabular-nums">
              {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {totalUnreadCount > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => markAllRead()}
              aria-label="Mark all notifications as read"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck aria-hidden="true" />
              <span>Mark all read</span>
            </Button>
          )}
          {hasAny && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => clear()}
              aria-label="Clear all notifications"
              className="text-muted-foreground hover:text-foreground"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-hairline px-3 py-2" role="group" aria-label="Filter notifications">
        <Button
          variant={!unreadOnly && !selectedCategory ? 'secondary' : 'ghost'}
          size="xs"
          aria-pressed={!unreadOnly && !selectedCategory}
          onClick={() => {
            setUnreadOnly(false)
            setSelectedCategory(undefined)
          }}
        >
          All
        </Button>
        <Button
          variant={unreadOnly ? 'secondary' : 'ghost'}
          size="xs"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly((v) => !v)}
        >
          Unread{totalUnreadCount > 0 ? ` (${totalUnreadCount})` : ''}
        </Button>
        {categories.map((cat) => (
          <Button
            key={cat}
            variant={selectedCategory === cat ? 'secondary' : 'ghost'}
            size="xs"
            aria-pressed={selectedCategory === cat}
            onClick={() => setSelectedCategory((cur) => (cur === cat ? undefined : cat))}
          >
            {cat}
          </Button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
            <Bell className="size-6 text-tier-4" aria-hidden="true" />
            <p className="text-sm font-medium text-tier-2">
              {unreadOnly ? 'No unread notifications' : 'You are all caught up'}
            </p>
            <p className="text-xs text-tier-3">
              New messages, approvals, and alerts will appear here.
            </p>
          </div>
        ) : (
          <ul role="list">
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                onMarkRead={markRead}
                onMarkUnread={markUnread}
                onRemove={remove}
                onClosePanel={onClose}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function NotificationPopover({ open, onOpenChange, trigger, panelId }: NotificationPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        id={panelId}
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className="w-96 p-0 shadow-float"
        style={{ maxWidth: 'calc(100vw - 1rem)' }}
        data-aiui-notifications-panel=""
      >
        <NotificationPanelBody onClose={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  )
}
