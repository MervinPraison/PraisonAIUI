/**
 * Page icons: a curated, STATIC map of 20 lucide icons keyed by page id
 * (then by an icon name a plugin may pass in `page.icon`). Built-in pages
 * declare emoji icons (server.py), so a dynamic lucide lookup by `page.icon`
 * would both miss and pull the whole lucide barrel into the boot chunk.
 *
 * Resolution (PageIcon.tsx): id map → name map → the emoji in `page.icon` →
 * FileText. Keep this list at 20 icons or fewer (boot budget, BRIEF WP6);
 * map new pages onto an existing icon before adding one.
 */
import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  Bug,
  ChartColumn,
  Clock,
  Code,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Plug,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { ShellPage } from '@/sdk/manifest'

export { FileText as FallbackPageIcon }

/** Every icon the page map may use (tests assert the ≤ 20 budget). */
export const PAGE_ICON_SET: readonly LucideIcon[] = [
  Activity,
  BookOpen,
  Bot,
  Brain,
  Bug,
  ChartColumn,
  Clock,
  Code,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Plug,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Zap,
]

export const ICON_BY_PAGE_ID: Readonly<Record<string, LucideIcon>> = {
  // Agent
  chat: MessageSquare,
  'chat-canvas': MessageSquare,
  channels: MessageSquare,
  inbox: MessageSquare,
  canvas: LayoutDashboard,
  agents: Bot,
  skills: Zap,
  marketplace: Plug,
  mcp: Plug,
  memory: Brain,
  knowledge: BookOpen,
  cron: Clock,
  schedules: Clock,
  guardrails: ShieldCheck,
  // Work
  work: LayoutDashboard,
  'jobs-board': LayoutDashboard,
  kanban: LayoutDashboard,
  // Control
  overview: LayoutDashboard,
  sessions: History,
  replay: History,
  runs: Activity,
  usage: ChartColumn,
  feedback: MessageSquare,
  jobs: ListChecks,
  approvals: ShieldCheck,
  api: Plug,
  nodes: Server,
  eval: ChartColumn,
  training: FlaskConical,
  'code-studio': Code,
  inspector: Bug,
  // Settings
  config: Settings,
  config_runtime: Settings,
  auth: ShieldCheck,
  security: ShieldCheck,
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
  bot: Bot,
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
  gear: Settings,
  history: History,
  'layout-dashboard': LayoutDashboard,
  'list-checks': ListChecks,
  logs: ScrollText,
  message: MessageSquare,
  'message-square': MessageSquare,
  plug: Plug,
  'scroll-text': ScrollText,
  server: Server,
  settings: Settings,
  shield: ShieldCheck,
  'shield-check': ShieldCheck,
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
