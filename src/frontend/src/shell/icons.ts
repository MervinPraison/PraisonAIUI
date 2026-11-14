/**
 * Page icons: a curated, STATIC map of 34 lucide icons keyed by name. The
 * manifest names each page's icon: built-in pages carry `navIcon` (their
 * `icon` is the emoji the legacy dashboard shows), and a plugin may put a
 * name in `icon`. A dynamic lucide lookup would pull the whole lucide barrel
 * into the boot chunk, hence the static map. The page id never decides.
 *
 * Resolution (PageIcon.tsx): `navIcon` → a name in `icon` → the emoji in
 * `icon` → FileText. Keep this list at 34 icons or fewer (about 300 B gzip each, in
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

/**
 * Icon names a page may give: in `navIcon` (the built-in pages do, from
 * builtin/catalog.py) or in `icon` (plugins). Lower-case lucide names, plus a
 * few short aliases.
 */
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

/** First emoji cluster (with ZWJ / variation-selector tails) in a string. */
const EMOJI_CLUSTER = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*/u

function iconByName(name: unknown): LucideIcon | undefined {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : ''
  return key && Object.prototype.hasOwnProperty.call(ICON_BY_NAME, key) ? ICON_BY_NAME[key] : undefined
}

/**
 * The lucide icon for a page, or undefined when it has none: its `navIcon`,
 * else a name in `icon`. An app or plugin page that reuses a built-in id
 * shows the icon it declares.
 */
export function iconForPage(page: Pick<ShellPage, 'icon' | 'navIcon'>): LucideIcon | undefined {
  return iconByName(page.navIcon) ?? iconByName(page.icon)
}

/** The emoji to show for a page without a lucide icon, if `page.icon` has one. */
export function emojiForPage(page: Pick<ShellPage, 'icon'>): string | undefined {
  if (typeof page.icon !== 'string' || page.icon.length > 32) return undefined
  return EMOJI_CLUSTER.exec(page.icon)?.[0]
}
