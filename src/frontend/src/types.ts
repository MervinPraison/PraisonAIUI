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
    // Streaming error state (Agent-UI pattern)
    streamingError?: boolean
    errorMessage?: string
    // Agent/Team info
    agentId?: string
    agentName?: string
    // Extra data
    extraData?: {
        references?: unknown[]
        reasoningSteps?: string[]
        [key: string]: unknown
    }
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

// Rich Event Types (27 types matching Agent-UI vocabulary)
export type RunEventType =
    // Agent events (13 types)
    | 'run_started'
    | 'run_content'
    | 'run_completed'
    | 'run_error'
    | 'run_cancelled'
    | 'tool_call_started'
    | 'tool_call_completed'
    | 'reasoning_started'
    | 'reasoning_step'
    | 'reasoning_completed'
    | 'memory_update_started'
    | 'memory_update_completed'
    | 'updating_memory'
    // Team events (11 types)
    | 'team_run_started'
    | 'team_run_content'
    | 'team_run_completed'
    | 'team_run_error'
    | 'team_run_cancelled'
    | 'team_tool_call_started'
    | 'team_tool_call_completed'
    | 'team_reasoning_started'
    | 'team_reasoning_step'
    | 'team_reasoning_completed'
    | 'team_memory_update_started'
    | 'team_memory_update_completed'
    // Control events
    | 'run_paused'
    | 'run_continued'

// Legacy SSE event types (backward compatible)
export type LegacyEventType =
    | 'session'
    | 'token'
    | 'message'
    | 'thinking'
    | 'tool_call'
    | 'ask'
    | 'image'
    | 'audio'
    | 'video'
    | 'file'
    | 'actions'
    | 'error'
    | 'end'
    | 'done'

// Combined event type (supports both legacy and new)
export type EventType = RunEventType | LegacyEventType

// SSE Event interface
export interface SSEEvent {
    type: EventType
    session_id?: string
    // Token streaming
    token?: string
    content?: string
    // Reasoning
    step?: string
    reasoning_steps?: string[]
    // Tool calls
    name?: string
    args?: Record<string, unknown>
    result?: unknown
    tool_call_id?: string
    // Ask/interaction
    question?: string
    options?: string[]
    // Media
    url?: string
    alt?: string
    images?: string[]
    videos?: string[]
    audio_url?: string
    // Actions
    buttons?: ActionButton[]
    // Error
    error?: string
    // Agent/Team info
    agent_id?: string
    agent_name?: string
    team_id?: string
    // Memory
    memory_type?: 'short_term' | 'long_term'
    // Extra data (Agent-UI pattern)
    extra_data?: {
        references?: unknown[]
        reasoning_steps?: string[]
        [key: string]: unknown
    }
}
