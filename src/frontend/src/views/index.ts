/**
 * Dashboard Views Registry
 *
 * Maps page IDs to their built-in view components.
 * Pages not in this registry fall through to CustomPageView.
 *
 * This is the protocol bridge: the server provides page metadata,
 * and this registry maps known page IDs to their React components.
 */
import type { ComponentType } from 'react'
import type { DashboardPageProps } from '../types/dashboard'

import { OverviewView } from './OverviewView'
import { SessionsView } from './SessionsView'
import { AgentsView } from './AgentsView'
import { ConfigView } from './ConfigView'
import { LogsView } from './LogsView'
import { UsageView } from './UsageView'
import { DebugView } from './DebugView'
import { RealtimeView } from './RealtimeView'
import { CustomPageView } from './CustomPageView'

/** Registry of built-in page components, keyed by page ID */
export const BUILTIN_VIEWS: Record<string, ComponentType<DashboardPageProps>> = {
    overview: OverviewView as unknown as ComponentType<DashboardPageProps>,
    sessions: SessionsView as unknown as ComponentType<DashboardPageProps>,
    agents: AgentsView as unknown as ComponentType<DashboardPageProps>,
    config: ConfigView as unknown as ComponentType<DashboardPageProps>,
    logs: LogsView as unknown as ComponentType<DashboardPageProps>,
    usage: UsageView as unknown as ComponentType<DashboardPageProps>,
    debug: DebugView as unknown as ComponentType<DashboardPageProps>,
    realtime: RealtimeView as unknown as ComponentType<DashboardPageProps>,
}

/**
 * Resolve a page ID to its view component.
 * Returns the built-in component if available, else CustomPageView.
 */
export function resolveView(pageId: string): ComponentType<DashboardPageProps> {
    return BUILTIN_VIEWS[pageId] || CustomPageView
}

export { CustomPageView }
