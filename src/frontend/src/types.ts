// Shared type definitions for PraisonAIUI frontend

export interface NavItem {
    title: string
    /** The page's own title, when the sidebar shows a shorter frontmatter `nav_title`. */
    pageTitle?: string
    /** A link, not a page: frontmatter `url:` or a `{label, href}` nav entry (an external one opens in a new tab). */
    href?: string
    path?: string
    description?: string
    noindex?: boolean
    /** Frontmatter `searchable: false`: left out of the site's own search (still in the sidebar). */
    searchable?: boolean
    /** Routable, but not in the sidebar or pager (frontmatter `hidden: true`, a hidden nav group or tab). */
    hidden?: boolean
    /** Date of the page's last commit (YYYY-MM-DD), from `aiui build` with `content.docs.lastUpdated`. */
    lastUpdated?: string
    /** "Edit this page" link, from `content.docs.editLink.pattern`. */
    editUrl?: string
    /** Sidebar icon (docsHomeIcons.ts docsIcon: a lucide name, an emoji or an image URL): group `icon:` in the nav YAML, page frontmatter `icon:`. */
    icon?: string
    /** A group's `expanded:` in the nav YAML: false starts it folded (the active page's group always opens). */
    expanded?: boolean
    /** A badge after the label (`tag:` on a nav group or in a page's frontmatter). */
    tag?: string
    /** Frontmatter `description` set: it shows under the title. */
    lede?: boolean
    /** Frontmatter `deprecated: true`: a sidebar badge, the label struck through and a notice on the page. */
    deprecated?: boolean
    /** Frontmatter `mode`: wide (no "On this page"), center (no sidebar either), custom (only the article), frame (custom with the sidebar). */
    mode?: 'wide' | 'center' | 'custom' | 'frame'
    /** Frontmatter `hideFooterPagination: true`: no previous / next links under the page. */
    hidePager?: boolean
    /** Frontmatter `noAnchor: true`: no copy-link icon on the headings. */
    noAnchor?: boolean
    /** The page's other frontmatter keys (scalars): `data-fm-*` on the article, `meta` in `aiui:content-loaded`. */
    meta?: Record<string, string | number | boolean>
    /** Head tags this page sets (`seo.paths` and frontmatter `canonical`, `robots`, `og:*`, `twitter:*`, ...). */
    seo?: Record<string, string>
    /** `card` | `accordion`: the build lists the group's pages on its page. */
    directory?: string
    children?: NavItem[]
}

export interface ThemeConfig {
    preset?: string
    radius?: string
    darkMode?: boolean
    /** The app's colour mode (live server only): set_theme / YAML, else 'system' (follow the OS). */
    mode?: 'light' | 'dark' | 'system'
}

export interface SiteConfig {
    title?: string
    logo?: string
    description?: string
    theme?: ThemeConfig
}

export interface SEOConfig {
    titleTemplate?: string
    defaultImage?: string
    twitter?: Record<string, string>
    siteUrl?: string
    robots?: { index?: boolean; follow?: boolean }
    /** Canonical and og:url end in `/` (`seo.trailingSlash`). */
    trailingSlash?: boolean
    /** `seo.metatags`: head tags on every page. */
    metatags?: Record<string, string>
}

export interface I18nConfig {
    defaultLocale?: string
    locales?: string[]
    rtlLocales?: string[]
    fallbackLocale?: string
    translationsDir?: string
}

export interface A11yConfig {
    skipToContent?: boolean
    focusVisible?: boolean
    reduceMotion?: boolean
    ariaLabels?: Record<string, string>
}

export interface LogoConfig {
    light?: string
    dark?: string
    href?: string
}

export interface NavTabGroupConfig {
    group: string
    icon?: string
    prefix?: string
    pages?: string[]
    /** Search ranking multiplier for the group's pages (a page's frontmatter `boost` wins). */
    boost?: number
}

export interface NavTabConfig {
    tab: string
    url?: string
    groups?: NavTabGroupConfig[]
}

export interface NavigationConfig {
    tabs?: NavTabConfig[]
}

export interface NavbarLinkConfig {
    label: string
    href: string
}

export interface NavbarPrimaryConfig {
    type?: 'button' | 'github'
    label?: string
    href: string
}

export interface NavbarConfig {
    primary?: NavbarPrimaryConfig
    links?: NavbarLinkConfig[]
}

export interface SearchConfig {
    enabled?: boolean
    provider?: string
    /** Placeholder of the search field and the header button (default "Search docs"). */
    prompt?: string
    /** Most results the dialog lists (1-100, default 24). */
    maxResults?: number
}

/** Searchable pages of one top-level nav group (docNav.docSearchGroups), with its tab and boost. */
export interface SearchGroup {
    title: string
    pages: NavItem[]
    tab?: string
    boost?: number
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
    debug?: boolean
    site?: SiteConfig
    style?: 'docs' | 'chat' | 'agents' | 'playground' | 'custom' | 'dashboard' | 'app'
    layout?: LayoutConfig
    chat?: ChatConfig
    auth?: AuthConfig
    widgets?: InputWidget[]
    components?: Record<string, { props?: Record<string, unknown> }>
    templates?: Record<string, TemplateConfig>
    seo?: SEOConfig
    i18n?: I18nConfig
    a11y?: A11yConfig
    logo?: LogoConfig
    navigation?: NavigationConfig
    navbar?: NavbarConfig
    search?: SearchConfig
    /** Hero and features of the docs home page (frontmatter `layout: home`). */
    docsHome?: DocsHomeConfig
    /** Page footer settings (`content.docs.editLink.text`, `content.docs.feedback.issues`). */
    pageFooter?: { editText?: string; feedbackIssues?: string }
    /** `styling.eyebrows`: the line above a docs page title (default `section`). */
    styling?: { eyebrows?: 'section' | 'breadcrumbs' }
    footer?: {
        socials?: Record<string, string>
        links?: { header: string; items: NavbarLinkConfig[] }[]
    }
}

/** Docs home page layout (frontmatter `layout: home` on docs/index.md; compiler/docs_home.py). */
export interface DocsHomeAction {
    text: string
    link: string
    theme?: 'brand' | 'alt'
}

export interface DocsHomeFeature {
    title: string
    details?: string
    icon?: string
    link?: string
    linkText?: string
}

export interface DocsHomeConfig {
    hero?: {
        name?: string
        text?: string
        tagline?: string
        image?: string
        imageDark?: string
        imageAlt?: string
        actions?: DocsHomeAction[]
    }
    features?: DocsHomeFeature[]
}

export interface DocsNav {
    items?: NavItem[]
    /** `content.docs.nav.collapsible: false`: groups never fold. */
    collapsible?: boolean
    /** `interaction.drilldown`: a group label with no page of its own opens the group's first page. */
    drilldown?: boolean
}

export interface RouteManifest {
    routes?: {
        pattern: string
        template: string
        priority?: number
        slotOverrides?: Record<string, SlotConfig | null>
    }[]
}

// Message element types (matching Python schema)
export interface MessageElement {
    type: 'image' | 'pdf' | 'video' | 'audio' | 'file' | 'code'
    name?: string
    display?: 'inline' | 'side' | 'page'
}

export interface ImageElement extends MessageElement {
    type: 'image'
    url: string
    alt?: string
    width?: number
    height?: number
}

export interface PdfElement extends MessageElement {
    type: 'pdf'
    url: string
}

export interface VideoElement extends MessageElement {
    type: 'video'
    url: string
    autoplay?: boolean
    controls?: boolean
    loop?: boolean
}

export interface AudioElement extends MessageElement {
    type: 'audio'
    url: string
    autoplay?: boolean
    controls?: boolean
    loop?: boolean
}

export interface FileElement extends MessageElement {
    type: 'file'
    url: string
    size?: number
    mimeType?: string
}

export interface CodeElement extends MessageElement {
    type: 'code'
    content: string
    language?: string
}

export type MessageElementUnion = ImageElement | PdfElement | VideoElement | AudioElement | FileElement | CodeElement

// Chat types
export interface ChatMessage {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: string
    thinking?: string[]
    toolCalls?: ToolCall[]
    // Rich inline elements (new standardized format)
    elements?: (MessageElementUnion | Record<string, unknown>)[]
    // Legacy format (for backward compatibility)
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
    description?: string
    icon?: string
    step_number?: number
    status?: 'running' | 'done' | 'error'
    tool_call_id?: string
    formatted_result?: string
    args?: Record<string, unknown>
    result?: unknown
    error?: string
    a2ui?: { messages: Record<string, unknown>[]; surface_id?: string }
    surface_id?: string
    elements?: (MessageElementUnion | Record<string, unknown>)[]
    capability?: 'stub' | 'live'
    warning?: string
}

export interface FileAttachment {
    url: string
    name: string
    type?: string
    size?: number
}

export interface ActionButton {
    id: string
    name: string
    label: string
    icon?: string
    variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline'
    payload?: Record<string, unknown>
    message_id?: string
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
    | 'message_element'
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
    description?: string
    icon?: string
    step_number?: number
    formatted_result?: string
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
    // Message elements (protocol-driven media)
    element?: MessageElementUnion | Record<string, unknown>
    elements?: (MessageElementUnion | Record<string, unknown>)[]
    // Extra data (Agent-UI pattern)
    extra_data?: {
        references?: unknown[]
        reasoning_steps?: string[]
        element?: MessageElementUnion | Record<string, unknown>
        elements?: (MessageElementUnion | Record<string, unknown>)[]
        [key: string]: unknown
    }
}
