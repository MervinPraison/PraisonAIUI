/**
 * Page icon names for layout frames: a static lucide map keyed by the names a
 * page gives in `navIcon` (or `icon`). It mirrors the shell's map
 * (shell/icons.ts, which a frame may not import, R17); the lucide modules are
 * the ones the boot chunk already holds for the classic sidebar.
 */
import {
  Activity,
  BookOpen,
  Bot,
  Braces,
  Brain,
  Bug,
  ChartColumn,
  ClipboardCheck,
  Clock,
  Code,
  Columns2,
  Columns3,
  FileText,
  FlaskConical,
  Gauge,
  History,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Lock,
  MessageSquare,
  MessagesSquare,
  PanelsTopLeft,
  Plug,
  Radio,
  RotateCcw,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  SquareKanban,
  Store,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { LayoutNavItem } from '@/sdk/layouts'

const ICONS: Readonly<Record<string, LucideIcon>> = {
  activity: Activity,
  agent: Bot,
  agents: Bot,
  'bar-chart': ChartColumn,
  book: BookOpen,
  'book-open': BookOpen,
  board: SquareKanban,
  bot: Bot,
  braces: Braces,
  brain: Brain,
  bug: Bug,
  chart: ChartColumn,
  'chart-column': ChartColumn,
  chat: MessageSquare,
  'clipboard-check': ClipboardCheck,
  clock: Clock,
  code: Code,
  'columns-2': Columns2,
  'columns-3': Columns3,
  dashboard: LayoutDashboard,
  file: FileText,
  'file-text': FileText,
  flask: FlaskConical,
  'flask-conical': FlaskConical,
  gauge: Gauge,
  gear: Settings,
  history: History,
  inbox: Inbox,
  kanban: SquareKanban,
  key: KeyRound,
  'key-round': KeyRound,
  'layout-dashboard': LayoutDashboard,
  'list-checks': ListChecks,
  lock: Lock,
  logs: ScrollText,
  message: MessageSquare,
  'message-square': MessageSquare,
  'messages-square': MessagesSquare,
  'panels-top-left': PanelsTopLeft,
  plug: Plug,
  radio: Radio,
  'rotate-ccw': RotateCcw,
  'scroll-text': ScrollText,
  server: Server,
  settings: Settings,
  shield: ShieldCheck,
  'shield-check': ShieldCheck,
  'square-kanban': SquareKanban,
  store: Store,
  tasks: ListChecks,
  zap: Zap,
}

function byName(name: unknown): LucideIcon | undefined {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : ''
  return key && Object.prototype.hasOwnProperty.call(ICONS, key) ? ICONS[key] : undefined
}

/** The lucide icon a nav item names (`navIcon`, else a name in `icon`), if any. */
export function iconForNavItem(item: Pick<LayoutNavItem, 'navIcon' | 'icon'>): LucideIcon | undefined {
  return byName(item.navIcon) ?? byName(item.icon)
}
