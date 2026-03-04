/**
 * Dashboard Protocol Types
 *
 * Defines the protocol interfaces for dashboard pages.
 * Both built-in pages and user-registered plugin pages
 * implement this same interface.
 */

/** Protocol: every dashboard page definition from the server */
export interface DashboardPageDef {
    id: string
    title: string
    icon: string
    group: string
    description: string
    api_endpoint: string
    order: number
}

/** Props every dashboard page view component receives */
export interface DashboardPageProps {
    page: DashboardPageDef
    onNavigate: (tabId: string) => void
}

/** A tab group in the sidebar (derived from page definitions) */
export interface DashboardTabGroup {
    label: string
    pages: DashboardPageDef[]
}
