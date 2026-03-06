"""Pydantic schema models for aiui.template.yaml configuration."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ThemeConfig(BaseModel):
    """Theme configuration."""
    # All official Tailwind color names
    preset: Literal[
        "zinc", "slate", "stone", "gray", "neutral",
        "red", "orange", "amber", "yellow", "lime",
        "green", "emerald", "teal", "cyan", "sky",
        "blue", "indigo", "violet", "purple", "fuchsia",
        "pink", "rose"
    ] = "zinc"
    radius: Literal["none", "sm", "md", "lg", "xl"] = "md"
    dark_mode: bool = Field(default=True, alias="darkMode")


class SiteConfig(BaseModel):
    """Site-level configuration."""

    title: str
    description: Optional[str] = None
    route_base_docs: str = Field(default="/docs", alias="routeBaseDocs")
    ui: Literal["shadcn", "mui", "chakra"] = "shadcn"
    theme: Optional[ThemeConfig] = None
    plugins: list[str] = Field(
        default_factory=lambda: [
            "nav-intercept",
            "fetch-retry",
            "mermaid",
            "mkdocs-compat",
            "homepage",
            "toc",
            "topnav",
            "code-copy",
            "syntax-highlight",
        ],
        description="List of frontend plugin names to enable",
    )


class NavConfig(BaseModel):
    """Navigation configuration for content sources."""

    mode: Literal["auto", "manual"] = "auto"
    sort: Literal["filesystem", "alpha", "date"] = "filesystem"
    collapsible: bool = True
    max_depth: int = Field(default=4, alias="maxDepth", ge=1, le=10)


class ContentSourceConfig(BaseModel):
    """Configuration for a single content source (docs, blog, etc.)."""

    dir: str
    include: list[str] = Field(default_factory=lambda: ["**/*.md", "**/*.mdx"])
    exclude: list[str] = Field(default_factory=list)
    index_files: list[str] = Field(
        default_factory=lambda: ["index.md", "README.md"], alias="indexFiles"
    )
    nav: Optional[NavConfig] = None


class ContentConfig(BaseModel):
    """Content sources configuration."""

    docs: Optional[ContentSourceConfig] = None
    blog: Optional[ContentSourceConfig] = None

    model_config = ConfigDict(extra="allow")


class SlotRef(BaseModel):
    """Reference to a component in a slot."""

    ref: Optional[str] = None
    type: Optional[str] = None


class WidgetConfig(BaseModel):
    """Widget configuration for zone-based layouts."""

    type: str
    props: dict[str, Any] = Field(default_factory=dict)


# Zone types for WordPress-style widget areas
ZoneWidgets = list[WidgetConfig]


class ZonesConfig(BaseModel):
    """Widget zones configuration - WordPress-style layout areas."""

    header: Optional[ZoneWidgets] = None
    top_nav: Optional[ZoneWidgets] = Field(default=None, alias="topNav")
    hero: Optional[ZoneWidgets] = None
    left_sidebar: Optional[ZoneWidgets] = Field(default=None, alias="leftSidebar")
    main: Optional[ZoneWidgets] = None
    right_sidebar: Optional[ZoneWidgets] = Field(default=None, alias="rightSidebar")
    bottom_nav: Optional[ZoneWidgets] = Field(default=None, alias="bottomNav")
    footer: Optional[ZoneWidgets] = None

    model_config = ConfigDict(populate_by_name=True)


class ComponentConfig(BaseModel):
    """Component definition."""

    type: str
    props: dict[str, Any] = Field(default_factory=dict)


class TemplateConfig(BaseModel):
    """Template definition with layout, slots (legacy), and zones (widget arrays)."""

    layout: str
    # Legacy slot-based assignment
    slots: dict[str, Optional[SlotRef]] = Field(default_factory=dict)
    # New zone-based widget assignment (WordPress-style)
    zones: Optional[ZonesConfig] = None


class RouteConfig(BaseModel):
    """Route rule mapping glob patterns to templates."""

    match: str
    template: str
    slots: Optional[dict[str, Optional[SlotRef]]] = None


class I18nConfig(BaseModel):
    """Internationalization configuration."""

    default_locale: str = Field(default="en", alias="defaultLocale")
    locales: list[str] = Field(default_factory=lambda: ["en"])
    rtl_locales: list[str] = Field(default_factory=list, alias="rtlLocales")
    fallback_locale: Optional[str] = Field(default=None, alias="fallbackLocale")
    translations_dir: str = Field(default="./translations", alias="translationsDir")


class A11yConfig(BaseModel):
    """Accessibility configuration."""

    skip_to_content: bool = Field(default=True, alias="skipToContent")
    focus_visible: bool = Field(default=True, alias="focusVisible")
    reduce_motion: bool = Field(default=False, alias="reduceMotion")
    aria_labels: dict[str, str] = Field(default_factory=dict, alias="ariaLabels")


class SEOConfig(BaseModel):
    """SEO configuration."""

    title_template: str = Field(default="%s", alias="titleTemplate")
    default_image: Optional[str] = Field(default=None, alias="defaultImage")
    twitter: Optional[dict[str, str]] = None


class DependenciesConfig(BaseModel):
    """Component dependencies configuration."""

    shadcn: list[str] = Field(
        default_factory=list,
        description="List of shadcn/ui component names to install"
    )


# ──────────────────────────────────────────────────────────────
# Mintlify-parity models (logo, nav tabs, navbar, footer, search)
# ──────────────────────────────────────────────────────────────

class LogoConfig(BaseModel):
    """Logo configuration with light/dark variants."""

    light: Optional[str] = None
    dark: Optional[str] = None
    href: str = "/"


class NavGroupConfig(BaseModel):
    """A navigation group within a tab."""

    group: str
    icon: Optional[str] = None
    prefix: Optional[str] = None
    pages: list[str] = Field(default_factory=list)


class NavTabConfig(BaseModel):
    """A top-level navigation tab."""

    tab: str
    url: Optional[str] = None
    groups: list[NavGroupConfig] = Field(default_factory=list)


class NavigationConfig(BaseModel):
    """Top-level navigation with tabs."""

    tabs: list[NavTabConfig] = Field(default_factory=list)


class NavbarLinkConfig(BaseModel):
    """A link in the top navbar."""

    label: str
    href: str


class NavbarPrimaryConfig(BaseModel):
    """Primary navbar action button."""

    type: Literal["button", "github"] = "button"
    label: Optional[str] = None
    href: str


class NavbarConfig(BaseModel):
    """Top navbar configuration."""

    primary: Optional[NavbarPrimaryConfig] = None
    links: list[NavbarLinkConfig] = Field(default_factory=list)


class FooterLinkItemConfig(BaseModel):
    """A single link in a footer column."""

    label: str
    href: str


class FooterLinkColumnConfig(BaseModel):
    """A column of links in the footer."""

    header: str
    items: list[FooterLinkItemConfig] = Field(default_factory=list)


class FooterConfig(BaseModel):
    """Footer configuration with socials and link columns."""

    socials: dict[str, str] = Field(default_factory=dict)
    links: list[FooterLinkColumnConfig] = Field(default_factory=list)


class SearchConfig(BaseModel):
    """Search configuration."""

    enabled: bool = True
    provider: Literal["fusejs", "lunrjs", "pagefind"] = "fusejs"


class ChatProfileConfig(BaseModel):
    """Chat profile configuration for agent selection."""

    name: str
    description: Optional[str] = None
    agent: Optional[str] = None
    icon: Optional[str] = None
    default: bool = False


class ChatStarterConfig(BaseModel):
    """Chat starter message configuration."""

    label: str
    message: str
    icon: Optional[str] = None


class ChatFeaturesConfig(BaseModel):
    """Chat features configuration."""

    streaming: bool = True
    file_upload: bool = Field(default=True, alias="fileUpload")
    audio: bool = False
    reasoning: bool = True
    tools: bool = True
    multimedia: bool = True
    history: bool = True
    feedback: bool = False
    code_execution: bool = Field(default=False, alias="codeExecution")

    model_config = ConfigDict(populate_by_name=True)


class ChatInputConfig(BaseModel):
    """Chat input configuration."""

    multimodal: bool = True
    audio: bool = False
    file_upload: bool = Field(default=True, alias="fileUpload")
    placeholder: str = "Type a message..."

    model_config = ConfigDict(populate_by_name=True)


class ChatConfig(BaseModel):
    """Chat configuration for AI chat interfaces."""

    enabled: bool = False
    name: Optional[str] = None
    starters: list[ChatStarterConfig] = Field(default_factory=list)
    profiles: list[ChatProfileConfig] = Field(default_factory=list)
    features: Optional[ChatFeaturesConfig] = None
    input: Optional[ChatInputConfig] = None

    model_config = ConfigDict(populate_by_name=True)


class LayoutConfig(BaseModel):
    """Layout configuration for chat positioning."""

    mode: Literal[
        "fullscreen", "sidebar", "bottom-right", "bottom-left",
        "top-right", "top-left", "embedded", "custom"
    ] = "fullscreen"
    width: Optional[str] = None
    height: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class AuthProviderConfig(BaseModel):
    """OAuth provider configuration."""

    name: str
    client_id: Optional[str] = Field(default=None, alias="clientId")
    client_secret: Optional[str] = Field(default=None, alias="clientSecret")

    model_config = ConfigDict(populate_by_name=True)


class AuthConfig(BaseModel):
    """Authentication configuration."""

    enabled: bool = False
    providers: list[Literal["password", "google", "github", "azure", "auth0"]] = Field(
        default_factory=lambda: ["password"]
    )
    oauth: list[AuthProviderConfig] = Field(default_factory=list)
    require_auth: bool = Field(default=False, alias="requireAuth")

    model_config = ConfigDict(populate_by_name=True)


class InputWidgetConfig(BaseModel):
    """Input widget configuration for settings panels."""

    type: Literal["slider", "select", "switch", "text", "number", "color"]
    name: str
    label: Optional[str] = None
    default: Optional[Any] = None
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: list[str] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class Config(BaseModel):
    """Root configuration model for aiui.template.yaml."""

    schema_version: int = Field(default=1, alias="schemaVersion")
    site: SiteConfig
    style: Literal["docs", "chat", "agents", "playground", "custom"] = "docs"
    layout: Optional[LayoutConfig] = None
    content: Optional[ContentConfig] = None
    components: dict[str, ComponentConfig] = Field(default_factory=dict)
    templates: dict[str, TemplateConfig] = Field(default_factory=dict)
    routes: list[RouteConfig] = Field(default_factory=list)
    chat: Optional[ChatConfig] = None
    auth: Optional[AuthConfig] = None
    widgets: list[InputWidgetConfig] = Field(default_factory=list)
    seo: Optional[SEOConfig] = None
    i18n: Optional[I18nConfig] = None
    a11y: Optional[A11yConfig] = None
    dependencies: Optional[DependenciesConfig] = None
    # Mintlify-parity fields
    logo: Optional[LogoConfig] = None
    navigation: Optional[NavigationConfig] = None
    navbar: Optional[NavbarConfig] = None
    footer: Optional[FooterConfig] = None
    search: Optional[SearchConfig] = None

    model_config = ConfigDict(populate_by_name=True)
