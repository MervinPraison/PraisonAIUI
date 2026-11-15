/**
 * Rail icons by the manifest's `navIcon` names (the frame may not import the
 * shell's icon table). A page without a known icon shows its first letter.
 */
import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  Bug,
  ChartColumn,
  Clock,
  Gauge,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  MessagesSquare,
  ScrollText,
  Settings2,
  ShieldCheck,
  SquareKanban,
  type LucideIcon,
} from 'lucide-react'

/** Lucide icons by `navIcon` name. */
export const RAIL_ICONS: Readonly<Record<string, LucideIcon>> = {
  activity: Activity,
  'book-open': BookOpen,
  bot: Bot,
  brain: Brain,
  bug: Bug,
  'chart-column': ChartColumn,
  clock: Clock,
  gauge: Gauge,
  inbox: Inbox,
  'layout-dashboard': LayoutDashboard,
  'list-checks': ListChecks,
  'message-square': MessageSquare,
  'messages-square': MessagesSquare,
  'scroll-text': ScrollText,
  settings: Settings2,
  'shield-check': ShieldCheck,
  'square-kanban': SquareKanban,
}
