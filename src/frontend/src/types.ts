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
    style?: 'docs' | 'chat' | 'agents' | 'playground' | 'custom'
    layout?: LayoutConfig
    chat?: ChatConfig
    auth?: AuthConfig
    widgets?: InputWidget[]
    components?: Record<string, { props?: Record<string, unknown> }>
    templates?: Record<string, TemplateConfig>
}

export interface DocsNav {
    items?: NavItem[]
}

export interface RouteManifest {
    routes?: { pattern: string; template: string }[]
}

// Chat types
export interface ChatMessage {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: string
    thinking?: string[]
    toolCalls?: ToolCall[]
    images?: string[]
    audio?: string[]
    video?: string[]
    files?: FileAttachment[]
    actions?: ActionButton[]
}

export interface ToolCall {
    name: string
    args?: Record<string, unknown>
    result?: unknown
    error?: string
}

export interface FileAttachment {
    url: string
    name: string
    type?: string
    size?: number
}

export interface ActionButton {
    name: string
    label: string
    icon?: string
}

export interface ChatProfile {
    name: string
    description?: string
    agent?: string
    icon?: string
    default?: boolean
}

export interface ChatStarter {
    label: string
    message: string
    icon?: string
}

export interface ChatFeatures {
    streaming?: boolean
    fileUpload?: boolean
    audio?: boolean
    reasoning?: boolean
    tools?: boolean
    multimedia?: boolean
    history?: boolean
    feedback?: boolean
    codeExecution?: boolean
}

export interface ChatInputConfig {
    multimodal?: boolean
    audio?: boolean
    fileUpload?: boolean
    placeholder?: string
}

export interface ChatConfig {
    enabled?: boolean
    name?: string
    starters?: ChatStarter[]
    profiles?: ChatProfile[]
    features?: ChatFeatures
    input?: ChatInputConfig
}

export interface LayoutConfig {
    mode?: 'fullscreen' | 'sidebar' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'embedded' | 'custom'
    width?: string
    height?: string
}

export interface AuthConfig {
    enabled?: boolean
    providers?: string[]
    requireAuth?: boolean
}

export interface InputWidget {
    type: 'slider' | 'select' | 'switch' | 'text' | 'number' | 'color'
    name: string
    label?: string
    default?: unknown
    min?: number
    max?: number
    step?: number
    options?: string[]
}

// SSE Event types
export interface SSEEvent {
    type: 'session' | 'token' | 'message' | 'thinking' | 'tool_call' | 'ask' | 'image' | 'audio' | 'video' | 'file' | 'actions' | 'error' | 'end' | 'done'
    session_id?: string
    token?: string
    content?: string
    step?: string
    name?: string
    args?: Record<string, unknown>
    result?: unknown
    question?: string
    options?: string[]
    url?: string
    alt?: string
    buttons?: ActionButton[]
    error?: string
}
