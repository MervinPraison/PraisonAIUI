"""Pydantic schema models for aiui.template.yaml configuration."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ThemeConfig(BaseModel):
    """Theme configuration."""

    radius: Literal["none", "sm", "md", "lg", "full"] = "md"
    brand_color: str = Field(default="indigo", alias="brandColor")
    dark_mode: bool = Field(default=True, alias="darkMode")


class SiteConfig(BaseModel):
    """Site-level configuration."""

    title: str
    description: Optional[str] = None
    route_base_docs: str = Field(default="/docs", alias="routeBaseDocs")
    ui: Literal["shadcn", "mui", "chakra"] = "shadcn"
    theme: Optional[ThemeConfig] = None


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

    class Config:
        extra = "allow"  # Allow additional content sources


class SlotRef(BaseModel):
    """Reference to a component in a slot."""

    ref: Optional[str] = None
    type: Optional[str] = None


class ComponentConfig(BaseModel):
    """Component definition."""

    type: str
    props: dict[str, Any] = Field(default_factory=dict)


class TemplateConfig(BaseModel):
    """Template definition with layout and slots."""

    layout: str
    slots: dict[str, Optional[SlotRef]] = Field(default_factory=dict)


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


class Config(BaseModel):
    """Root configuration model for aiui.template.yaml."""

    schema_version: int = Field(default=1, alias="schemaVersion")
    site: SiteConfig
    content: Optional[ContentConfig] = None
    components: dict[str, ComponentConfig] = Field(default_factory=dict)
    templates: dict[str, TemplateConfig] = Field(default_factory=dict)
    routes: list[RouteConfig] = Field(default_factory=list)
    seo: Optional[SEOConfig] = None
    i18n: Optional[I18nConfig] = None
    a11y: Optional[A11yConfig] = None

    class Config:
        populate_by_name = True
