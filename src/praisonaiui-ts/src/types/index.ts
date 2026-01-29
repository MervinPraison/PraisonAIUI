/**
 * Type definitions for PraisonAIUI - shared across packages (DRY)
 */

// Site configuration
export interface ThemeConfig {
    radius: "none" | "sm" | "md" | "lg" | "full";
    brandColor: string;
    darkMode: boolean;
}

export interface SiteConfig {
    title: string;
    description?: string;
    routeBaseDocs: string;
    ui: "shadcn" | "mui" | "chakra";
    theme?: ThemeConfig;
}

// Content configuration
export interface NavConfig {
    mode: "auto" | "manual";
    sort: "filesystem" | "alpha" | "date";
    collapsible: boolean;
    maxDepth: number;
}

export interface ContentSourceConfig {
    dir: string;
    include: string[];
    exclude: string[];
    indexFiles: string[];
    nav?: NavConfig;
}

export interface ContentConfig {
    docs?: ContentSourceConfig;
    blog?: ContentSourceConfig;
    [key: string]: ContentSourceConfig | undefined;
}

// Slots and components
export interface SlotRef {
    ref?: string;
    type?: string;
}

export interface ComponentConfig {
    type: string;
    props: Record<string, unknown>;
}

export interface TemplateConfig {
    layout: string;
    slots: Record<string, SlotRef | null>;
}

export interface RouteConfig {
    match: string;
    template: string;
    slots?: Record<string, SlotRef | null>;
}

// SEO configuration
export interface SEOConfig {
    titleTemplate: string;
    defaultImage?: string;
    twitter?: {
        site?: string;
        creator?: string;
    };
}

// i18n configuration
export interface I18nConfig {
    defaultLocale: string;
    locales: string[];
    rtlLocales: string[];
    fallbackLocale?: string;
    translationsDir: string;
}

// Accessibility configuration
export interface A11yConfig {
    skipToContent: boolean;
    focusVisible: boolean;
    reduceMotion: boolean;
    ariaLabels: Record<string, string>;
}

// Root configuration
export interface Config {
    schemaVersion: number;
    site: SiteConfig;
    content?: ContentConfig;
    components: Record<string, ComponentConfig>;
    templates: Record<string, TemplateConfig>;
    routes: RouteConfig[];
    seo?: SEOConfig;
    i18n?: I18nConfig;
    a11y?: A11yConfig;
}

// Generated manifest types
export interface UIConfig {
    site: SiteConfig;
    components: Record<string, ComponentConfig>;
    templates: Record<string, TemplateConfig>;
}

export interface NavItem {
    title: string;
    path: string;
    children?: NavItem[];
}

export interface NavTree {
    items: NavItem[];
}

export interface RouteEntry {
    pattern: string;
    template: string;
    priority: number;
    slotOverrides?: Record<string, SlotRef | null>;
}

export interface RouteManifest {
    routes: RouteEntry[];
}
