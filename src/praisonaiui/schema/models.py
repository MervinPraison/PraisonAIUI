"""Pydantic schema models for the aiui.yaml site configuration."""

from __future__ import annotations

import re
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator, model_validator


class ModeImages(BaseModel):
    """An image per colour mode (favicon, page background)."""

    light: Optional[str] = None
    dark: Optional[str] = None


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
            "Accent colour (any CSS colour) that overrides the preset's accent "
            "(docs site and the React app shell). Links and focus rings are "
            "derived from it with AA contrast."
        ),
    )
    accent_dark: Optional[str] = Field(
        default=None,
        alias="accentDark",
        description="Accent colour in dark mode (docs site; default: derived from accent).",
    )
    strict: bool = Field(
        default=False,
        description="Docs site: keep the configured mode and hide the light/dark toggle.",
    )
    background: Optional[Union[str, ModeImages]] = Field(
        default=None,
        description=(
            "Docs site page background: 'gradient', 'grid', an image path or URL, "
            "or {light, dark} images."
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
    sort: Literal["filesystem", "alpha", "date"] = "filesystem"  # in a folder: name, title, `date` (newest first)
    collapsible: bool = True  # sidebar groups fold open and shut (false: always open)
    max_depth: int = Field(default=4, alias="maxDepth", ge=1, le=10)  # not read; validate warns
    directory: Optional[Literal["card", "accordion"]] = None  # list each folder's pages (navigation.md)

    model_config = ConfigDict(populate_by_name=True)


class EditLinkConfig(BaseModel):
    """"Edit this page" under each docs page."""

    pattern: str = Field(
        description="URL with :path for the page's source path, e.g. "
        "https://github.com/acme/site/edit/main/docs/:path",
    )
    text: str = "Edit this page"


class FeedbackConfig(BaseModel):
    """"Was this page helpful?" under each docs page. ``aiui serve`` and ``aiui dev``
    store the votes (``aiui docs feedback`` lists them); a static host posts them
    to ``endpoint``. ``content.docs.feedback: false`` turns it off."""

    issues: Optional[str] = Field(
        default=None,
        description="New-issue URL a \"No\" also offers, e.g. https://github.com/acme/site/issues/new",
    )
    endpoint: Union[Literal[False], str, None] = Field(
        default=None,
        description="Where votes are POSTed on a static host (an https:// URL); false sends none "
        "(only the aiui:docs-feedback browser event). Default: the aiui server stores them",
    )
    code: bool = Field(default=False, description="A thumbs-down on each code block, to flag a broken sample")

    @field_validator("endpoint")
    @classmethod
    def _endpoint_url(cls, v: Union[bool, str, None]) -> Union[bool, str, None]:
        if isinstance(v, str) and not re.match(r"^(https?://\S+|/\S*)$", v):
            raise ValueError("endpoint must be an http(s) URL or a path starting with /")
        return v


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
    feedback: Union[FeedbackConfig, bool, None] = None
    mcp: bool = Field(
        default=True,
        description="Serve a read-only MCP server at /mcp from aiui serve and aiui dev "
        "(docs/features/ai-ready-docs.md#mcp-server)",
    )

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


#: A head tag name: ``seo.metatags`` / ``seo.paths`` keys (compiler/seo.py).
META_TAG_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_.:-]{0,63}")


class SEOPathConfig(BaseModel):
    """``seo.paths`` entry: head tags for every page under ``path`` (``/docs/v1``, ``v1`` or ``v1/*``)."""

    path: str
    metatags: dict[str, Union[str, int, float]] = Field(default_factory=dict)

    @field_validator("metatags")
    @classmethod
    def _check_metatags(cls, value: dict) -> dict:
        return _check_tag_names(value)


class SEOOrganizationConfig(BaseModel):
    """``seo.organization``: the JSON-LD Organization every page names as publisher."""

    name: Optional[str] = None
    url: Optional[str] = None
    logo: Optional[str] = None
    same_as: list[str] = Field(default_factory=list, alias="sameAs")

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
    og_images: bool = Field(
        default=True,
        alias="ogImages",
        description="Draw a 1200x630 social card per docs page as its og:image (needs Pillow); "
        "false keeps defaultImage",
    )
    content_signals: Optional[ContentSignalsConfig] = Field(default=None, alias="contentSignals")
    metatags: dict[str, Union[str, int, float]] = Field(
        default_factory=dict,
        description="Extra head tags on every page (google-site-verification, og:locale, ...); "
        "og:* keys are written as property=, the rest as name=",
    )
    paths: list[SEOPathConfig] = Field(
        default_factory=list, description="Head tags for the pages under a folder; the longest path wins"
    )
    organization: Optional[SEOOrganizationConfig] = Field(
        default=None, description="The JSON-LD Organization (default: the site title, URL and logo)"
    )

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("metatags")
    @classmethod
    def _check_metatags(cls, value: dict) -> dict:
        return _check_tag_names(value)


def _check_tag_names(tags: dict) -> dict:
    bad = [k for k in tags if not META_TAG_NAME.fullmatch(k)]
    if bad:
        raise ValueError(f"not a meta tag name: {', '.join(map(repr, bad))} (letters, digits, : . _ -)")
    return tags


class MarkdownConfig(BaseModel):
    """``markdown:`` — the agent-ready Markdown ``aiui build`` publishes (docs/features/ai-ready-docs.md)."""

    instructions: Optional[Union[str, list[str]]] = Field(
        default=None,
        description="Guidance for AI agents, prepended to every page's .md, llms.txt and llms-full.txt",
    )

    model_config = ConfigDict(populate_by_name=True)


class DependenciesConfig(BaseModel):
    """Component dependencies configuration."""

    shadcn: list[str] = Field(
        default_factory=list, description="List of shadcn/ui component names to install"
    )


# ──────────────────────────────────────────────────────────────
# Docs site models (logo, nav tabs, navbar, footer, search)
# ──────────────────────────────────────────────────────────────


class LogoConfig(BaseModel):
    """Logo configuration with light/dark variants."""

    light: Optional[str] = None
    dark: Optional[str] = None
    href: str = "/"


class OpenApiSourceConfig(BaseModel):
    """``{source, directory}`` form of an ``openapi`` entry."""

    source: str  # spec file (relative to the config) or http(s) URL
    directory: Optional[str] = None  # folder its endpoint pages go under (default api-reference)


# `openapi:` takes a path or URL, a {source, directory} object, or a list of either.
OpenApiRef = Union[str, OpenApiSourceConfig, list[Union[str, OpenApiSourceConfig]]]


class ApiParamsConfig(BaseModel):
    """``api.params``: how endpoint pages show parameters."""

    expanded: Literal["all", "closed"] = "closed"  # all: nested properties start open


class ApiExamplesConfig(BaseModel):
    """``api.examples``: request examples on endpoint pages."""

    # curl python javascript go java ruby php csharp rust swift (aliases: node, shell, c#, ...),
    # "all", or [] for the spec's own x-codeSamples only
    languages: Union[Literal["all"], list[str]] = ["curl", "python", "javascript"]

    @field_validator("languages")
    @classmethod
    def _known(cls, value: Union[str, list[str]]) -> list[str]:
        from praisonaiui.compiler.code_samples import LANGUAGES, language

        if value == "all":
            return list(LANGUAGES)
        unknown = [x for x in value if language(x) not in LANGUAGES]
        if unknown:
            raise ValueError(f"unknown language {', '.join(unknown)}; use any of {', '.join(LANGUAGES)}")
        return list(dict.fromkeys(map(language, value)))

    # Try-it inputs start filled from the spec's examples (x-default, example, default);
    # false leaves them empty with the example as the placeholder.
    prefill: bool = True


class ApiPlaygroundConfig(BaseModel):
    """``api.playground``: the Try-it panel on endpoint pages (front matter ``playground:`` per page)."""

    # interactive: endpoint bar with Try it; simple: the bar without it; none: method and path as text
    display: Literal["interactive", "simple", "none"] = "interactive"


class ApiAuthConfig(BaseModel):
    """``api.auth``: the credential Try it asks for on ``api:`` pages (a header input)."""

    method: Literal["bearer", "basic", "key", "none"] = "bearer"
    name: Optional[str] = None  # the header for `key` (default X-API-Key)


class ApiConfig(BaseModel):
    """``api:`` — API reference settings (OpenAPI specs; see docs/features/openapi.md)."""

    openapi: Optional[OpenApiRef] = None
    params: Optional[ApiParamsConfig] = None
    examples: Optional[ApiExamplesConfig] = None
    playground: Optional[ApiPlaygroundConfig] = None
    server: Optional[Union[str, list[str]]] = None  # base URL(s) of `api: "POST /v1/users"` pages (no spec)
    auth: Optional[ApiAuthConfig] = None


class NavLinkConfig(BaseModel):
    """A link in a nav group's ``pages`` (``{label, href}``): an external site opens in a new tab."""

    label: str
    href: str = Field(pattern=r"^(https?://|/|mailto:)")
    icon: Optional[str] = None
    tag: Optional[str] = Field(default=None, max_length=24)

    def page_slugs(self, trail: str = "") -> list[str]:
        return []  # a link is not a page


class NavGroupConfig(BaseModel):
    """A navigation group within a tab.

    ``pages`` lists page slugs (``getting-started/quickstart``, ``index``); an
    entry may also be a nested group (``{group: Layouts, pages: [...]}``) or a
    link (``{label: GitHub, href: https://github.com/...}``). With
    ``content.docs.nav.mode: manual`` the sidebar is built from these lists, in
    this order; otherwise they only assign folders to tabs.
    """

    group: str
    icon: Optional[str] = None
    prefix: Optional[str] = None
    root: Optional[str] = None  # the group's own page: its sidebar label links there
    expanded: Optional[bool] = None  # false: starts folded (the active page's group always opens)
    tag: Optional[str] = Field(default=None, max_length=24)  # a small badge after the label ("New")
    directory: Optional[Literal["card", "accordion"]] = None  # list its pages on its (or a generated) page
    hidden: bool = False  # pages stay routable but leave the sidebar (and indexing, see seo.indexing)
    # Search ranking multiplier for the group's pages (a page's own `boost` wins).
    boost: Optional[float] = Field(default=None, ge=0.1, le=10)
    pages: list[Union[str, "NavGroupConfig", NavLinkConfig]] = Field(default_factory=list)
    openapi: Optional[OpenApiRef] = None

    def page_slugs(self, trail: str = "") -> list[str]:
        """Every page entry (the root, or a generated listing page, first), nested groups flattened, in order."""
        trail = f"{trail}/{re.sub(r'[^a-z0-9]+', '-', self.group.lower()).strip('-') or 'group'}".lstrip("/")
        out: list[str] = [self.root] if self.root else [trail] if self.directory else []
        for entry in self.pages:
            out.extend([entry] if isinstance(entry, str) else entry.page_slugs(trail))
        return out


NavGroupConfig.model_rebuild()


class NavDivisionConfig(BaseModel):
    """What tabs, tab menu items, anchors and dropdowns share: a link out (``href``),
    or a part of the docs with its own sidebar (``groups`` and/or ``pages``)."""

    model_config = ConfigDict(populate_by_name=True)

    icon: Optional[str] = None
    href: Optional[str] = Field(default=None, pattern=r"^(https?://|/|mailto:)")
    hidden: bool = False  # it and its pages leave the header and sidebar (pages stay routable)
    groups: list[NavGroupConfig] = Field(default_factory=list)
    pages: list[Union[str, NavGroupConfig, NavLinkConfig]] = Field(default_factory=list)

    @property
    def label(self) -> str:
        return next(getattr(self, k) for k in ("tab", "item", "anchor", "dropdown") if hasattr(self, k))

    def children(self) -> list["NavDivisionConfig"]:
        return [*getattr(self, "menu", []), *getattr(self, "tabs", [])]

    def sidebar_groups(self) -> list[NavGroupConfig]:
        """Its groups, with its loose ``pages`` as a first untitled group."""
        return [NavGroupConfig(group="", pages=self.pages)] * bool(self.pages) + self.groups


class NavMenuItemConfig(NavDivisionConfig):
    """An item of a tab's dropdown menu."""

    item: str
    description: Optional[str] = None


class NavTabConfig(NavDivisionConfig):
    """A top-level navigation tab: its own sidebar, a link (``href``), or a ``menu`` of items."""

    tab: str
    url: Optional[str] = None  # older spelling of href
    menu: list[NavMenuItemConfig] = Field(default_factory=list)
    openapi: Optional[OpenApiRef] = None


class NavAnchorConfig(NavDivisionConfig):
    """A link pinned at the top of the sidebar on every page; with ``groups``/``pages`` it opens its own sidebar."""

    anchor: str


class NavDropdownConfig(NavDivisionConfig):
    """An entry of the switcher at the top of the sidebar (a product or a section), with its own sidebar or tabs."""

    dropdown: str = Field(alias="product")
    description: Optional[str] = None
    tabs: list[NavTabConfig] = Field(default_factory=list)


class NavGlobalConfig(BaseModel):
    """``navigation.global``: links shown on every page, whatever tab or dropdown is open."""

    anchors: list[NavAnchorConfig] = Field(default_factory=list)


class NavigationConfig(BaseModel):
    """Top-level navigation: header tabs, sidebar anchors and a dropdown switcher, or a sidebar listed at the root."""

    model_config = ConfigDict(populate_by_name=True)

    tabs: list[NavTabConfig] = Field(default_factory=list)
    anchors: list[NavAnchorConfig] = Field(default_factory=list)
    dropdowns: list[NavDropdownConfig] = Field(default_factory=list, alias="products")
    global_: Optional[NavGlobalConfig] = Field(default=None, alias="global")
    pages: list[Union[str, NavGroupConfig, NavLinkConfig]] = Field(default_factory=list)
    groups: list[NavGroupConfig] = Field(default_factory=list)

    def divisions(self) -> list[tuple[NavDivisionConfig, bool]]:
        """Every tab, menu item, anchor and dropdown (nested ones after their parent), with whether it is hidden."""
        out: list[tuple[NavDivisionConfig, bool]] = []

        def walk(d: NavDivisionConfig, hidden: bool) -> None:
            out.append((d, hidden or d.hidden))
            for c in d.children():
                walk(c, hidden or d.hidden)

        for d in [*self.tabs, *self.anchors, *self.dropdowns, *(self.global_.anchors if self.global_ else [])]:
            walk(d, False)
        return out


class InteractionConfig(BaseModel):
    """``interaction:`` — how the docs sidebar responds."""

    drilldown: bool = False  # clicking a group's label opens its first page


class StylingConfig(BaseModel):
    """``styling:`` — page chrome."""

    eyebrows: Literal["section", "breadcrumbs"] = "section"  # above a docs page title: its group, or all


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

    model_config = ConfigDict(populate_by_name=True)

    enabled: bool = True
    # Accepted for old configs; the built-in index is always used (validate warns).
    provider: Literal["fusejs", "lunrjs", "pagefind"] = "fusejs"
    prompt: Optional[str] = None  # the search field's placeholder ("Search docs")
    max_results: Optional[int] = Field(default=None, alias="maxResults", ge=1, le=100)


class RedirectConfig(BaseModel):
    """One redirect (docs/features/redirects.md): ``source`` and ``destination``
    are site paths; ``:name`` matches one path segment and a final ``:name*``
    the rest of the path, and ``destination`` reuses them."""

    source: str
    destination: str
    permanent: bool = Field(default=True, description="301 (default); false for a temporary 302")

    @field_validator("source")
    @classmethod
    def _check_source(cls, value: str) -> str:
        if not value.startswith("/"):
            raise ValueError("a redirect source is a site path starting with '/'")
        if re.search(r":\w+\*.", value.rstrip("/")):
            raise ValueError("':name*' matches the rest of the path, so it must come last")
        return value


class NotFoundConfig(BaseModel):
    """The page a URL with no page shows (``errors: {404: …}``)."""

    title: Optional[str] = Field(default=None, description="Heading, default 'Page not found'")
    description: Optional[str] = Field(default=None, description="Markdown under the heading")
    redirect: bool = Field(default=False, description="Send readers to the home page instead")


class ErrorsConfig(BaseModel):
    """Error pages; ``404`` (or ``notFound``) is the page-not-found view."""

    not_found: Optional[NotFoundConfig] = Field(default=None, alias="404")

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="before")
    @classmethod
    def _aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):  # YAML reads `404:` as an int key
            data = {("404" if k in (404, "notFound") else k): v for k, v in data.items()}
        return data


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
    markdown: Optional[MarkdownConfig] = None
    i18n: Optional[I18nConfig] = None
    a11y: Optional[A11yConfig] = None
    dependencies: Optional[DependenciesConfig] = None
    # Docs site fields
    logo: Optional[LogoConfig] = None
    favicon: Optional[ModeImages] = None
    navigation: Optional[NavigationConfig] = None
    navbar: Optional[NavbarConfig] = None
    footer: Optional[FooterConfig] = None
    search: Optional[SearchConfig] = None
    api: Optional[ApiConfig] = None
    interaction: Optional[InteractionConfig] = None
    styling: Optional[StylingConfig] = None
    redirects: list[RedirectConfig] = Field(
        default_factory=list, description="Moved pages (docs/features/redirects.md)"
    )
    errors: Optional[ErrorsConfig] = None
    variables: dict[str, Union[str, int, float, bool]] = Field(
        default_factory=dict,
        description="Values for {{name}} in docs pages (docs/features/writing-docs.md#reusable-snippets-and-variables)",
    )

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("logo", "favicon", mode="before")
    @classmethod
    def _one_image(cls, value: Any) -> Any:
        """``logo: logo.svg`` / ``favicon: icon.svg``: one image for both modes."""
        return {"light": value} if isinstance(value, str) else value


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
