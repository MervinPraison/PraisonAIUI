/** Lucide icons by name for the Chat and Canvas nav (see ./icons). */
import {
  BookOpen,
  Bot,
  Bug,
  Clock,
  Columns2,
  History,
  Layers,
  MessageSquare,
  MessagesSquare,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import type { LayoutNavItem } from '@/sdk/layouts'

const BY_NAME: Readonly<Record<string, LucideIcon>> = {
  chat: MessageSquare,
  'message-square': MessageSquare,
  'messages-square': MessagesSquare,
  layers: Layers,
  artifacts: Layers,
  bot: Bot,
  agents: Bot,
  clock: Clock,
  cron: Clock,
  'book-open': BookOpen,
  knowledge: BookOpen,
  history: History,
  sessions: History,
  settings: Settings,
  config: Settings,
  'columns-2': Columns2,
  bug: Bug,
}

/** The lucide icon for a nav item: its `navIcon`, a name in `icon`, else its page id. */
export function iconFor(item: Pick<LayoutNavItem, 'id' | 'navIcon' | 'icon'>): LucideIcon | undefined {
  return BY_NAME[item.navIcon ?? ''] ?? BY_NAME[item.icon ?? ''] ?? BY_NAME[item.id]
}
