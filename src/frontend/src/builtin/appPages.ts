/**
 * The app shell's React pages for five built-in pages (ProOverview,
 * ProList twice, ProLogs and ProSettings in the Pro tokens). Each is the
 * browser half of its Python record (builtin.overview, builtin.sessions,
 * builtin.agents, builtin.logs, builtin.config): it registers only when the manifest lists
 * the page, through the same `registerPage` a plugin uses, and its code is
 * a lazy chunk fetched when the page is opened.
 *
 * Inside a layout frame the React page renders; in the classic frame it
 * renders the legacy view as before (app-pages/shared inLayoutOnly). The
 * default `dashboard` style never loads the React shell, so its pages are
 * unchanged (R6).
 */
import { Settings } from 'lucide-react'
import type { BuiltinPlugin, BuiltinSdk } from './types'

type Loader = () => Promise<{ default: import('react').ComponentType<{ page: import('@/sdk/manifest').ShellPage }> }>

function pagePlugin(record: string, pageId: string, load: Loader, extra?: (sdk: BuiltinSdk) => void): BuiltinPlugin {
  return {
    name: record,
    pages: [pageId],
    activate(sdk, { pageIds }) {
      if (!pageIds.includes(pageId)) return
      sdk.registerPage(pageId, load)
      extra?.(sdk)
    },
  }
}

/**
 * "Settings" in the palette (its Preferences section): the page is titled
 * Config, so "set" or "settings" would otherwise not find it.
 */
function settingsCommand(sdk: BuiltinSdk): void {
  sdk.registerCommand({
    id: 'config.open',
    title: 'Settings',
    group: 'Preferences',
    keywords: ['config', 'configuration', 'preferences', 'options', 'provider', 'model', 'api key'],
    icon: Settings,
    run: () => sdk.navigate('config'),
  })
}

export const appPageBuiltins: readonly BuiltinPlugin[] = Object.freeze([
  pagePlugin('builtin.overview', 'overview', () => import('@/app-pages/overview/OverviewPage')),
  pagePlugin('builtin.sessions', 'sessions', () => import('@/app-pages/sessions/SessionsPage')),
  pagePlugin('builtin.agents', 'agents', () => import('@/app-pages/agents/AgentsPage')),
  pagePlugin('builtin.logs', 'logs', () => import('@/app-pages/logs/LogsPage')),
  pagePlugin('builtin.config', 'config', () => import('@/app-pages/settings/SettingsPage'), settingsCommand),
])
