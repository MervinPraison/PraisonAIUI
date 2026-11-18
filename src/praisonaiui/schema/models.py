"""Pydantic schema models for the aiui.yaml site configuration."""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator


class ThemeConfig(BaseModel):
    """Theme configuration."""

    # All official Tailwind color names
    preset: Literal[
        "zinc",
        "slate",
        "stone",
        "gray",
        "neutral",
        "red",
        "orange",
        "amber",
        "yellow",
        "lime",
        "green",
        "emerald",
        "teal",
        "cyan",
        "sky",
        "blue",
        "indigo",
        "violet",
        "purple",
        "fuchsia",
        "pink",
        "rose",
        "paper",
    ] = "zinc"
    radius: Literal["none", "sm", "md", "lg", "xl"] = "md"
    dark_mode: bool = Field(default=True, alias="darkMode")
    mode: Optional[Literal["light", "dark", "system"]] = Field(
        default=None,
        description=(
            "Colour mode before the viewer picks one; wins over darkMode. "
            "'system' follows the OS."
        ),
    )
    accent: Optional[str] = Field(
        default=None,
        description=(
            "Accent colour (any CSS colour) that overrides the preset's accent. "
            "Used by the React app shell (style 'app')."
        ),
    )
    density: Optional[Literal["compact", "comfortable", "spacious"]] = Field(
        default=None,
        description="Control density of the React app shell (style 'app').",
    )

    model_config = ConfigDict(populate_by_name=True)


class SiteConfig(BaseModel):
    """Site-level configuration."""

    title: str
    description: Optional[str] = None
    route_base_docs: str = Field(default="/docs", alias="routeBaseDocs")
    base_path: Optional[str] = Field(
        default=None,
        alias="basePath",
        description="URL path a static build is published under (/docs, /my-repo), "
        "or 'auto' for a GitHub Pages project site. Default: the path of seo.siteUrl, else the root",
    )
    ui: Literal["shadcn", "mui", "chakra"] = "shadcn"
    theme: Optional[ThemeConfig] = None
    logo: Optional[str] = Field(
        default=None,
        description="Logo emoji or image path for sidebar branding",
    )
    custom_css: Optional[str] = Field(
        default=None,
        alias="customCss",
        description="Custom CSS string injected into the page as an inline <style> tag",
    )
    # The React docs app renders code (Shiki), mermaid, tabs, the TOC and the
    # header tabs itself; the other legacy plugins (mermaid, syntax-highlight,
    # code-copy, toc, mkdocs-compat, content-loader, homepage, topnav) skip
    # React docs pages, and the first two pulled ~40 files from two CDNs per
    # page. nav-intercept keeps in-article /docs links on SPA navigation.
    # A site can still list any of them here.
    plugins: list[str] = Field(
        default_factory=lambda: ["fetch-retry", "nav-intercept"],
        description="List of frontend plugin names to enable",
    )

    model_config = ConfigDict(populate_by_name=True)


class NavConfig(BaseModel):
    """Navigation configuration for content sources."""

    mode: Literal["auto", "manual"] = "auto"
    sort: Literal["filesystem", "alpha", "date"] = "filesystem"
    collapsible: bool = True
    max_depth: int = Field(default=4, alias="maxDepth", ge=1, le=10)


class EditLinkConfig(BaseModel):
    """"Edit this page" under each docs page."""

    pattern: str = Field(
        description="URL with :path for the page's source path, e.g. "
        "https://github.com/acme/site/edit/main/docs/:path",
    )
    text: str = "Edit this page"


class FeedbackConfig(BaseModel):
    """"Was this page helpful?" under each docs page. Nothing is stored: a "No"
    opens a new issue with the page filled in."""

    issues: str = Field(description="New-issue URL, e.g. https://github.com/acme/site/issues/new")


class ContentSourceConfig(BaseModel):
    """Configuration for a single content source (docs, blog, etc.)."""

    dir: str
    include: list[str] = Field(default_factory=lambda: ["**/*.md", "**/*.mdx"])
    exclude: list[str] = Field(default_factory=list)
    index_files: list[str] = Field(
        default_factory=lambda: ["index.md", "README.md"], alias="indexFiles"
    )
    nav: Optional[NavConfig] = None
    edit_link: Optional[EditLinkConfig] = Field(default=None, alias="editLink")
    last_updated: bool = Field(default=False, alias="lastUpdated")
    feedback: Optional[FeedbackConfig] = None

    model_config = ConfigDict(populate_by_name=True)


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


class ContentSignalsConfig(BaseModel):
    """robots.txt ``Content-Signal`` (contentsignals.org): how crawlers may use the pages.
    Unset keys are left out of the line."""

    search: Optional[bool] = None
    ai_input: Optional[bool] = Field(default=None, alias="aiInput")
    ai_train: Optional[bool] = Field(default=None, alias="aiTrain")

    model_config = ConfigDict(populate_by_name=True)


class SEOConfig(BaseModel):
    """SEO configuration."""

    title_template: str = Field(default="%s | %s", alias="titleTemplate")
    default_image: Optional[str] = Field(default=None, alias="defaultImage")
    twitter: Optional[dict[str, str]] = None
    site_url: Optional[str] = Field(default=None, alias="siteUrl")
    robots: Optional[dict[str, bool]] = None
    indexing: Literal["navigable", "all"] = Field(
        default="navigable",
        description="navigable: hidden pages stay out of the sitemap, llms.txt and search; "
        "all: every page that is not noindex is indexed",
    )
    trailing_slash: bool = Field(default=False, alias="trailingSlash")
    content_signals: Optional[ContentSignalsConfig] = Field(default=None, alias="contentSignals")

    model_config = ConfigDict(populate_by_name=True)


class DependenciesConfig(BaseModel):
    """Component dependencies configuration."""

    shadcn: list[str] = Field(
        default_factory=list, description="List of shadcn/ui component names to install"
    )


# ──────────────────────────────────────────────────────────────
# Mintlify-parity models (logo, nav tabs, navbar, footer, search)
# ──────────────────────────────────────────────────────────────


class LogoConfig(BaseModel):
    """Logo configuration with light/dark variants."""

    light: Optional[str] = None
    dark: Optional[str] = None
    href: str = "/"


class OpenApiSourceConfig(BaseModel):
    """``{source, directory}`` form of an ``openapi`` entry."""

    source: str  # spec file (relative to the config) or http(s) URL
    directory: Optional[str] = None  # folder its endpoint pages go under (planned)


# `openapi:` takes a path or URL, a {source, directory} object, or a list of either.
OpenApiRef = Union[str, OpenApiSourceConfig, list[Union[str, OpenApiSourceConfig]]]


class ApiConfig(BaseModel):
    """``api:`` — API reference settings (OpenAPI specs; see docs/features/openapi.md)."""

    openapi: Optional[OpenApiRef] = None


class NavGroupConfig(BaseModel):
    """A navigation group within a tab.

    ``pages`` lists page slugs (``getting-started/quickstart``, ``index``); an
    entry may also be a nested group (``{group: Layouts, pages: [...]}``). With
    ``content.docs.nav.mode: manual`` the sidebar is built from these lists, in
    this order; otherwise they only assign folders to tabs.
    """

    group: str
    icon: Optional[str] = None
    prefix: Optional[str] = None
    hidden: bool = False  # pages stay routable but leave the sidebar (and indexing, see seo.indexing)
    pages: list[Union[str, "NavGroupConfig"]] = Field(default_factory=list)
    openapi: Optional[OpenApiRef] = None

    def page_slugs(self) -> list[str]:
        """Every page entry, nested groups flattened, in order."""
        out: list[str] = []
        for entry in self.pages:
            out.extend([entry] if isinstance(entry, str) else entry.page_slugs())
        return out


NavGroupConfig.model_rebuild()


class NavTabConfig(BaseModel):
    """A top-level navigation tab."""

    tab: str
    url: Optional[str] = None
    hidden: bool = False  # the tab and its groups' pages leave the header and sidebar
    groups: list[NavGroupConfig] = Field(default_factory=list)
    openapi: Optional[OpenApiRef] = None


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


class DashboardConfig(BaseModel):
    """Dashboard layout configuration."""

    sidebar: bool = Field(default=True, description="Show the left sidebar navigation")
    page_header: bool = Field(
        default=True, alias="pageHeader", description="Show page title/description header"
    )
    modules: list[str] = Field(
        default_factory=list,
        description="Optional dashboard JS modules to load (jobs, auth, api)",
    )
    plugin_dirs: list[str] = Field(
        default_factory=list,
        alias="pluginDirs",
        description="Extra directories to scan for dashboard-plugins manifests",
    )

    model_config = ConfigDict(populate_by_name=True)


class LayoutConfig(BaseModel):
    """Layout configuration: chat positioning (``mode``, ``width``, ``height``)
    and, for ``style: app``, the selectable shell layouts (ADR 0003).

    - ``default``: the layout a viewer starts with; ``classic`` is the
      shell's own frame. ``AIUI_LAYOUT`` and ``aiui.set_layout()`` win.
    - ``available``: the layouts offered, in picker order (default: every
      layout the enabled plugins declare).
    - ``user_choice``: a viewer's own pick may override ``default``.
    - ``primary``: page ids of the primary nav, for every layout.
    - ``options``: per-layout settings, keyed by layout id.

    A bare string is shorthand: ``layout: command`` is ``{default: command}``.
    A malformed selection entry (a bad id, a string where a list goes) never
    fails the config: it is dropped, as the server drops it, and listed in
    ``rejected`` for ``aiui validate`` (warning 5103).
    """

    mode: Literal[
        "fullscreen",
        "sidebar",
        "bottom-right",
        "bottom-left",
        "top-right",
        "top-left",
        "embedded",
        "custom",
    ] = "fullscreen"
    width: Optional[str] = None
    height: Optional[str] = None
    default: Optional[str] = None
    available: Optional[list[str]] = None
    user_choice: bool = Field(default=True, alias="userChoice")
    primary: Optional[list[str]] = None
    options: dict[str, dict[str, Any]] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)

    #: Selection entries dropped as malformed: key → reason.
    _rejected: dict[str, str] = PrivateAttr(default_factory=dict)

    @property
    def rejected(self) -> dict[str, str]:
        return dict(self._rejected)

    @model_validator(mode="wrap")
    @classmethod
    def _selection(cls, data: Any, handler: Any) -> "LayoutConfig":
        if isinstance(data, str):
            data = {"default": data}
        rejected: dict[str, str] = {}
        if isinstance(data, dict):
            from praisonaiui.layouts import split_selection

            valid, rejected = split_selection(data)
            data = {k: v for k, v in data.items() if k not in rejected} | valid
        model = handler(data)
        model._rejected = rejected
        return model


class AuthProviderConfig(BaseModel):
    """OAuth provider configuration."""

    name: str
    client_id: Optional[str] = Field(default=None, alias="clientId")
    client_secret: Optional[str] = Field(default=None, alias="clientSecret")

    model_config = ConfigDict(populate_by_name=True)


class AuthConfig(BaseModel):
    """Authentication configuration."""

    enabled: bool = False
    providers: list[Literal["password", "google", "github", "azure", "auth0", "url_token"]] = Field(
        default_factory=lambda: ["password"]
    )
    oauth: list[AuthProviderConfig] = Field(default_factory=list)
    require_auth: bool = Field(default=False, alias="requireAuth")
    # With requireAuth, POST /register is open only for the first user unless this is set.
    allow_signup: bool = Field(default=False, alias="allowSignup")
    url_token: Optional[str] = Field(default=None, alias="urlToken")
    url_token_env: Optional[str] = Field(
        default="AIUI_URL_TOKEN", alias="urlTokenEnv"
    )

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


class MessageElement(BaseModel):
    """Base class for message elements (images, PDFs, videos, etc.)."""

    type: Literal["image", "pdf", "video", "audio", "file", "code"]
    name: Optional[str] = None
    display: Literal["inline", "side", "page"] = "inline"

    model_config = ConfigDict(populate_by_name=True)

    def __getitem__(self, key: str) -> Any:
        """Provide dict-style access for backward compatibility."""
        return getattr(self, key)

    def get(self, key: str, default: Any = None) -> Any:
        """Provide dict-style get method for backward compatibility.

        Treats both missing attributes and None values as 'not set'
        to match legacy dict-format behaviour where None fields were absent.
        """
        value = getattr(self, key, None)
        return default if value is None else value

    async def send(self, content: str = "") -> Any:
        """Send this element as a standalone message.

        Args:
            content: Optional message content to accompany the element

        Returns:
            The Message object that was sent
        """
        # Import here to avoid circular imports
        from praisonaiui.message import Message

        msg = Message(content=content, elements=[self])
        await msg.send()
        return msg


class ImageElement(MessageElement):
    """Image element for messages."""

    type: Literal["image"] = "image"
    url: str
    alt: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None


class PdfElement(MessageElement):
    """PDF element for messages."""

    type: Literal["pdf"] = "pdf"
    url: str


class VideoElement(MessageElement):
    """Video element for messages."""

    type: Literal["video"] = "video"
    url: str
    autoplay: bool = False
    controls: bool = True
    loop: bool = False


class AudioElement(MessageElement):
    """Audio element for messages."""

    type: Literal["audio"] = "audio"
    url: str
    autoplay: bool = False
    controls: bool = True
    loop: bool = False


class FileElement(MessageElement):
    """File download element for messages."""

    type: Literal["file"] = "file"
    url: str
    size: Optional[int] = None
    mime_type: Optional[str] = Field(default=None, alias="mimeType")

    model_config = ConfigDict(populate_by_name=True)


class CodeElement(MessageElement):
    """Code block element for messages."""

    type: Literal["code"] = "code"
    content: str
    language: Optional[str] = None


# Union type for all element types
MessageElementUnion = (
    ImageElement | PdfElement | VideoElement | AudioElement | FileElement | CodeElement
)


class ExtensionsConfig(BaseModel):
    """Entry-point plugin policy (group ``praisonaiui.plugins``), YAML ``extensions:``.

    - ``enabled`` omitted: every installed plugin is imported (``pip install``
      means trust). A list makes it a strict allowlist of *third-party*
      plugins only; it never switches a built-in or a plugin passed to
      ``aiui.register_plugin()`` off.
    - ``disabled`` always wins, and a disabled plugin is never imported. It
      also takes built-in record names, ``builtin.<name>`` (for example
      ``builtin.training``), which removes that built-in's pages and its
      optional features. A feature the host itself needs (a record listed as
      ``required``) keeps running. A bare name such as ``training`` means a
      third-party plugin of that name, never the built-in.
    - A bare list (``extensions: [a, b]``) is shorthand for ``enabled``.

    Plugin *browser* surfaces (pages, blocks, tool renderers and the static
    ``/_plugins/<name>/`` dir) are default-deny when the server requires auth or
    is reached from a non-loopback address: they are only served for plugins
    named in ``enabled``.

    Distinct from ``site.plugins`` (docs JS plugins) and ``dashboard.plugins``
    (legacy dashboard-plugin allowlist).
    """

    enabled: Optional[list[str]] = None
    disabled: list[str] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="before")
    @classmethod
    def _bare_list_means_enabled(cls, data: Any) -> Any:
        if isinstance(data, (list, tuple)):
            return {"enabled": list(data)}
        return data


class Config(BaseModel):
    """Root configuration model for aiui.yaml."""

    schema_version: int = Field(default=1, alias="schemaVersion")
    site: SiteConfig
    style: Literal["docs", "chat", "agents", "playground", "dashboard", "custom", "app"] = "docs"
    layout: Optional[LayoutConfig] = None
    content: Optional[ContentConfig] = None
    components: dict[str, ComponentConfig] = Field(default_factory=dict)
    templates: dict[str, TemplateConfig] = Field(default_factory=dict)
    routes: list[RouteConfig] = Field(default_factory=list)
    chat: Optional[ChatConfig] = None
    auth: Optional[AuthConfig] = None
    widgets: list[InputWidgetConfig] = Field(default_factory=list)
    dashboard: Optional[DashboardConfig] = None
    extensions: Optional[ExtensionsConfig] = None
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
    api: Optional[ApiConfig] = None

    model_config = ConfigDict(populate_by_name=True)


# ── Ask* message family models (issue #16) ──────────────────────────


class Action(BaseModel):
    """Action button model for AskActionMessage."""

    name: str
    label: str
    icon: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class FileResponse(BaseModel):
    """Response model for file uploads."""

    path: str
    mime: str
    size: int
    name: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class ActionResponse(BaseModel):
    """Response model for action selection."""

    action: Action

    model_config = ConfigDict(populate_by_name=True)


class ElementResponse(BaseModel):
    """Response model for element interactions."""

    payload: dict[str, Any]
    return_type: str

    model_config = ConfigDict(populate_by_name=True)
