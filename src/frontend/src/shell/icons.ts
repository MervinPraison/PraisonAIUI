/**
 * Page icons: a curated, STATIC map of 34 lucide icons keyed by page id
 * (then by an icon name a plugin may pass in `page.icon`). Built-in pages
 * declare emoji icons (server.py), so a dynamic lucide lookup by `page.icon`
 * would both miss and pull the whole lucide barrel into the boot chunk.
 *
 * Resolution (PageIcon.tsx): id map → name map → the emoji in `page.icon` →
 * FileText. Keep this list at 34 icons or fewer (about 300 B gzip each, in
 * the boot chunk; the boot budget is ratcheted in .size-limit). Pages that
 * sit near each other in the sidebar get distinct icons, so the collapsed
 * icon rail stays usable.
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
import type { ShellPage } from '@/sdk/manifest'

export { FileText as FallbackPageIcon }

/** Every icon the page map may use (tests assert the ≤ 34 budget). */
export const PAGE_ICON_SET: readonly LucideIcon[] = [
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
]

export const ICON_BY_PAGE_ID: Readonly<Record<string, LucideIcon>> = {
  // Agent
  chat: MessageSquare,
  'chat-canvas': Columns2,
  channels: Radio,
  inbox: Inbox,
  canvas: PanelsTopLeft,
  agents: Bot,
  skills: Zap,
  marketplace: Store,
  mcp: Plug,
  memory: Brain,
  knowledge: BookOpen,
  cron: Clock,
  schedules: Clock,
  guardrails: ShieldCheck,
  // Work
  work: LayoutDashboard,
  'jobs-board': Columns3,
  kanban: SquareKanban,
  // Control
  overview: Gauge,
  sessions: MessagesSquare,
  replay: RotateCcw,
  runs: Activity,
  usage: ChartColumn,
  feedback: MessageSquare,
  jobs: ListChecks,
  approvals: ShieldCheck,
  api: Braces,
  nodes: Server,
  eval: ClipboardCheck,
  training: FlaskConical,
  'code-studio': Code,
  inspector: Bug,
  // Settings
  config: Settings,
  config_runtime: Settings,
  auth: KeyRound,
  security: Lock,
  logs: ScrollText,
  debug: Bug,
  telemetry: Activity,
  traces: Activity,
  'theme-picker': Settings,
}

/** Lucide-style names a plugin page may put in `icon`. */
export const ICON_BY_NAME: Readonly<Record<string, LucideIcon>> = {
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
  clock: Clock,
  code: Code,
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
  'layout-dashboard': LayoutDashboard,
  'list-checks': ListChecks,
  lock: Lock,
  logs: ScrollText,
  message: MessageSquare,
  'message-square': MessageSquare,
  plug: Plug,
  radio: Radio,
  'scroll-text': ScrollText,
  server: Server,
  settings: Settings,
  shield: ShieldCheck,
  'shield-check': ShieldCheck,
  store: Store,
  tasks: ListChecks,
  zap: Zap,
}

/** First emoji cluster (with ZWJ / variation-selector tails) in a string. */
const EMOJI_CLUSTER = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*/u

/** The lucide icon for a page, or undefined when it has none. */
export function iconForPage(page: Pick<ShellPage, 'id' | 'icon'>): LucideIcon | undefined {
  const byId = ICON_BY_PAGE_ID[page.id]
  if (byId) return byId
  const name = typeof page.icon === 'string' ? page.icon.trim().toLowerCase() : ''
  return name ? ICON_BY_NAME[name] : undefined
}

/** The emoji to show for a page without a lucide icon, if `page.icon` has one. */
export function emojiForPage(page: Pick<ShellPage, 'icon'>): string | undefined {
  if (typeof page.icon !== 'string' || page.icon.length > 32) return undefined
  return EMOJI_CLUSTER.exec(page.icon)?.[0]
}
