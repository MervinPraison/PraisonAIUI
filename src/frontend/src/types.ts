// Shared type definitions for PraisonAIUI frontend

export interface NavItem {
    title: string
    href?: string
    path?: string
    children?: NavItem[]
}

export interface ThemeConfig {
    preset?: string
    radius?: string
    darkMode?: boolean
}

export interface SiteConfig {
    title?: string
    description?: string
    theme?: ThemeConfig
}

export interface WidgetConfig {
    type: string
    props?: Record<string, unknown>
}

export interface ZonesConfig {
    header?: WidgetConfig[]
    topNav?: WidgetConfig[]
    hero?: WidgetConfig[]
    leftSidebar?: WidgetConfig[]
    main?: WidgetConfig[]
    rightSidebar?: WidgetConfig[]
    bottomNav?: WidgetConfig[]
    footer?: WidgetConfig[]
}

export interface SlotConfig {
    ref?: string
    type?: string
    props?: Record<string, unknown>
}

export interface TemplateConfig {
    layout?: string
    slots?: Record<string, SlotConfig>
    zones?: ZonesConfig
}

export interface UIConfig {
    site?: SiteConfig
    components?: Record<string, { props?: Record<string, unknown> }>
    templates?: Record<string, TemplateConfig>
}

export interface DocsNav {
    items?: NavItem[]
}

export interface RouteManifest {
    routes?: { pattern: string; template: string }[]
}
