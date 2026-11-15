/**
 * The lucide icons for the manifest's `navIcon` names Mission's
 * destinations use: static imports (no dynamic lucide lookup, R10), drawn
 * with createElement so no component is made during render.
 */
import { createElement, type ComponentType, type ReactElement } from 'react'
import { Activity, Bot, ClipboardCheck, History, LayoutDashboard, MessageSquare, MessagesSquare, Settings, ShieldCheck } from 'lucide-react'
import type { LayoutNavItem } from '@/sdk/layouts'

export type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

const ICONS: Readonly<Record<string, IconComponent>> = Object.freeze({
  'layout-dashboard': LayoutDashboard,
  gauge: LayoutDashboard,
  bot: Bot,
  'shield-check': ShieldCheck,
  'clipboard-check': ClipboardCheck,
  'message-square': MessageSquare,
  'messages-square': MessagesSquare,
  activity: Activity,
  history: History,
  settings: Settings,
})

/** The icon component for a nav item, or undefined (PhoneTabs takes the component). */
export function iconFor(item: Pick<LayoutNavItem, 'navIcon'>): IconComponent | undefined {
  return item.navIcon ? ICONS[item.navIcon] : undefined
}

/** The icon element for a nav item, or null when its `navIcon` is not one of these. */
export function renderNavIcon(item: Pick<LayoutNavItem, 'navIcon'>, className: string): ReactElement | null {
  const icon = iconFor(item)
  return icon ? createElement(icon, { 'aria-hidden': true, className }) : null
}
