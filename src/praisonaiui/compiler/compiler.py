"""Main compiler - orchestrates the build process."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from praisonaiui.compiler import agent_markdown as am
from praisonaiui.compiler.content_lint import ContentIssue, accent_contrast, check_pages
from praisonaiui.compiler.docs_home import docs_home_from_frontmatter
from praisonaiui.compiler.docs_scanner import DocPage, DocsScanner
from praisonaiui.compiler.docs_tags import lint_pages
from praisonaiui.compiler.llms import write_llms_files
from praisonaiui.compiler.nav_builder import NavBuilder, external_url, manual_entries, nav_trails
from praisonaiui.compiler.nav_directory import _walk as walk_nav
from praisonaiui.compiler.nav_directory import write_directory_pages
from praisonaiui.compiler.openapi_pages import api_catalog, build_api_reference, strip_excluded
from praisonaiui.compiler.publish import (
    apply_indexing,
    content_signal,
    is_excluded,
    read_ignore_file,
    robots_content,
    set_robots_meta,
    with_slash,
)
from praisonaiui.schema.models import NavConfig
from praisonaiui.schema.validators import validate_config
from praisonaiui.utils import json_for_html

if TYPE_CHECKING:
    from praisonaiui.schema.models import Config


@dataclass
class CompileResult:
    """Result of compilation."""

    success: bool
    files: list[str]
    error: str | None = None
    #: Docs paths left out of the output (content.docs.exclude, .aiuiignore); folders end in "/".
    excluded: list[str] = field(default_factory=list)
    #: Problems that did not stop the build, e.g. ``docs/a.md:3: <Gadget> is not a docs component …``.
    warnings: list[str] = field(default_factory=list)


class Compiler:
    """Main compiler that generates manifests from configuration."""

    def __init__(
        self, config: "Config", base_path: Path | None = None, url_base: str | None = None
    ):
        self.config = config
        self.base_path = base_path or Path.cwd()  # the project folder
        # `aiui build --base-path`: the URL path the site is published under
        # (base_path.resolve_base_path). Resolved by compile().
        self._url_base_option = url_base
        self.url_base = ""
        self._inferred_site_url: str | None = None
        self._excluded: list[str] = []
        self._api = None  # openapi_pages.ApiReference: endpoint pages (compile() sets it)
        self._api_sources: dict[str, Path] = {}  # route -> published source of an endpoint page
        self._spec_files: list[tuple[str, str]] = []  # (title, published path) per spec

    def compile(self, output_dir: Path, minify: bool = False) -> CompileResult:
        """
        Compile configuration and docs into manifests.

        Args:
            output_dir: Directory to write manifests
            minify: Whether to minify JSON output

        Returns:
            CompileResult with generated files
        """
        # Apply composition resolver before validation
        self._apply_composition_resolver()

        from praisonaiui.compiler.base_path import resolve_base_path

        try:
            self.url_base, self._inferred_site_url = resolve_base_path(
                self._url_base_option,
                self.config.site.base_path,
                self.config.seo.site_url if self.config.seo else None,
                self.base_path,
            )
        except ValueError as e:
            return CompileResult(success=False, files=[], error=str(e))

        # Validate first
        validation = validate_config(self.config, self.base_path)
        if not validation.valid:
            errors = "; ".join(e.message for e in validation.errors)
            return CompileResult(success=False, files=[], error=f"Validation failed: {errors}")
        self._api, self._api_sources = self._api_reference(validation.api_specs), {}

        # Install component dependencies if specified
        if self.config.dependencies and self.config.dependencies.shadcn:
            from praisonaiui.components import ensure_components

            # Let ensure_components auto-detect the frontend path
            installed, failed = ensure_components(self.config.dependencies.shadcn)
            if failed > 0:
                return CompileResult(
                    success=False, files=[], error=f"Failed to install {failed} component(s)"
                )

        # Ensure output directory exists
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / ".nojekyll").touch()
        files: list[str] = [".nojekyll"]

        indent = None if minify else 2

        # Generate ui-config.json
        ui_config = self._generate_ui_config()
        self._write_json(output_dir / "ui-config.json", ui_config, indent)
        files.append("ui-config.json")

        # Generate docs-nav.json if docs exist
        if self.config.content and self.config.content.docs:
            nav = self._generate_docs_nav()
            self._annotate_page_footer(nav)
            self._write_json(output_dir / "docs-nav.json", nav, indent)
            files.append("docs-nav.json")

        # Generate route-manifest.json
        route_manifest = self._generate_route_manifest()
        self._write_json(output_dir / "route-manifest.json", route_manifest, indent)
        files.append("route-manifest.json")

        # Copy viewer.html for serve command
        self._copy_viewer(output_dir)
        files.append("index.html")

        # Generate theme.css — always, using defaults when site.theme is None
        from praisonaiui.themes import get_radius_value, inject_theme_css

        theme = self.config.site.theme
        inject_theme_css(
            output_dir,
            preset=theme.preset if theme else "zinc",
            dark_mode=theme.dark_mode if theme else True,
            radius=get_radius_value(theme.radius if theme else "md"),
        )
        files.append("assets/theme.css")

        # OpenAPI specs (loaded and checked once, by validate_config)
        files.extend(self._write_api_specs(output_dir, validation.api_specs, indent))

        # Copy docs markdown files for content loading
        warnings = [w.message for w in validation.warnings if w.category in ("navigation", "i18n")]
        if self.config.content and self.config.content.docs:
            copied = self._copy_docs(output_dir)
            files.extend(copied)
            warnings.extend(self.lint_docs())

        # Generate per-route HTML pages (SPA fallback + SEO)
        if self.config.content and self.config.content.docs:
            nav = self._generate_docs_nav()
            base, site = self.config.site.route_base_docs, self._site_url() or self.url_base
            files.extend(write_directory_pages(nav, output_dir, base, site))
            route_files = self._generate_route_pages(output_dir, nav)
            files.extend(route_files)
            files.extend(self._generate_sitemap(output_dir, nav))
            files.extend(self._generate_robots(output_dir))
            files.extend(write_llms_files(self, output_dir, nav))
            files.extend(self._generate_search_index(output_dir, nav))
            self._patch_homepage_seo(output_dir, nav)

        return CompileResult(success=True, files=files, excluded=self._excluded, warnings=warnings)

    def lint_docs(self) -> list[str]:
        """Warnings for the docs pages: component tags the renderer does not know (docs_tags.py)."""
        return lint_pages((page.path for page in self._published_pages()), self.base_path)

    def lint_content(self) -> list[ContentIssue]:
        """``aiui validate``'s content checks (content_lint.py): front matter, alt text, headings, …"""
        theme = self.config.site.theme if self.config.site else None
        issues, pages = accent_contrast(theme.accent if theme else None), self._published_pages()
        # A group page the build appends a directory listing to is not empty (nav_directory.py).
        base = self.config.site.route_base_docs.rstrip("/") + "/"
        items = walk_nav(self._generate_docs_nav().get("items", [])) if pages else ()
        listed = frozenset(i["path"].removeprefix(base) for i in items if i.get("directory") and i.get("path") and i.get("children"))
        return issues + check_pages(pages, self.base_path, listed)

    def _published_pages(self) -> list:
        """The docs pages the build publishes (``content.docs`` minus excludes)."""
        docs = self.config.content.docs if self.config.content else None
        if not docs or not (self.base_path / docs.dir).exists():
            return []
        scanner = DocsScanner(
            docs_dir=self.base_path / docs.dir,
            include=docs.include,
            exclude=self._exclude_patterns(),
            index_files=docs.index_files,
        )
        return scanner.scan()

    def _apply_composition_resolver(self) -> None:
        """Apply composition resolver to auto-wire components to zones."""
        for template_name, template in self.config.templates.items():
            if template.layout == "FlexibleLayout":
                if template.zones is None:
                    from praisonaiui.schema.models import ZonesConfig
                    template.zones = ZonesConfig()
                # Auto-wire components to common zone mappings
                self._auto_wire_component_to_zone(template, "sidebar", "leftSidebar")
                self._auto_wire_component_to_zone(template, "header", "header")
                self._auto_wire_component_to_zone(template, "footer", "footer")

    def _auto_wire_component_to_zone(self, template, component_name: str, zone_name: str) -> None:
        """Auto-wire a component to a zone if component exists but zone is empty."""
        if component_name in self.config.components and template.zones:
            # Convert zone name to proper attribute name
            zone_attr = self._zone_name_to_attr(zone_name)

            # Check if the zone attribute exists and is empty
            if hasattr(template.zones, zone_attr):
                current_zone = getattr(template.zones, zone_attr, None)

                # If zone is empty, add the component as a widget
                if current_zone is None:
                    from praisonaiui.schema.models import WidgetConfig

                    component = self.config.components[component_name]
                    widget = WidgetConfig(type=component.type, props=component.props)
                    setattr(template.zones, zone_attr, [widget])

    def _zone_name_to_attr(self, zone_name: str) -> str:
        """Convert camelCase zone name to snake_case attribute name."""
        # Convert camelCase to snake_case
        result = ""
        for i, char in enumerate(zone_name):
            if char.isupper() and i > 0:
                result += "_"
            result += char.lower()
        return result

    def _generate_ui_config(self) -> dict:
        """Generate ui-config.json content."""
        result = {
            "site": {
                "title": self.config.site.title,
                "description": self.config.site.description,
                "routeBaseDocs": self.config.site.route_base_docs,
                "ui": self.config.site.ui,
                "theme": (
                    {
                        "radius": self.config.site.theme.radius,
                        "preset": self.config.site.theme.preset,
                        "darkMode": self.config.site.theme.dark_mode,
                        **(
                            {"mode": self.config.site.theme.mode}
                            if self.config.site.theme.mode
                            else {}
                        ),
                    }
                    if self.config.site.theme
                    else None
                ),
            },
            "components": {
                name: {"type": comp.type, "props": comp.props}
                for name, comp in self.config.components.items()
            },
            "templates": {
                name: self._serialize_template(template)
                for name, template in self.config.templates.items()
            },
        }

        # Add style field
        if self.config.style:
            result["style"] = self.config.style

        # Add layout config
        if self.config.layout:
            result["layout"] = {
                "mode": self.config.layout.mode,
                "width": self.config.layout.width,
                "height": self.config.layout.height,
            }

        # Add chat config
        if self.config.chat:
            chat_dict = {
                "enabled": self.config.chat.enabled,
                "name": self.config.chat.name,
            }
            if self.config.chat.starters:
                chat_dict["starters"] = [
                    {"label": s.label, "message": s.message, "icon": s.icon}
                    for s in self.config.chat.starters
                ]
            if self.config.chat.profiles:
                chat_dict["profiles"] = [
                    {
                        "name": p.name,
                        "description": p.description,
                        "agent": p.agent,
                        "icon": p.icon,
                        "default": p.default,
                    }
                    for p in self.config.chat.profiles
                ]
            if self.config.chat.features:
                chat_dict["features"] = self.config.chat.features.model_dump(by_alias=True)
            if self.config.chat.input:
                chat_dict["input"] = self.config.chat.input.model_dump(by_alias=True)
            result["chat"] = chat_dict

        # Add auth config
        if self.config.auth:
            result["auth"] = {
                "enabled": self.config.auth.enabled,
                "providers": self.config.auth.providers,
                "requireAuth": self.config.auth.require_auth,
            }

        # Add widgets config
        if self.config.widgets:
            result["widgets"] = [
                {
                    "type": w.type,
                    "name": w.name,
                    "label": w.label,
                    "default": w.default,
                    "min": w.min,
                    "max": w.max,
                    "step": w.step,
                    "options": w.options if w.options else None,
                }
                for w in self.config.widgets
            ]

        # ── Mintlify-parity fields ──

        # Navigation with tabs (endpoint pages added where a spec is named)
        navigation = (self._api.config if self._api else self.config).navigation
        if navigation and navigation.tabs:
            result["navigation"] = {
                "tabs": [
                    {
                        "tab": t.tab,
                        "url": t.url,
                        "groups": [
                            {
                                "group": g.group,
                                "icon": g.icon,
                                "prefix": g.prefix,
                                "pages": g.page_slugs(),
                                **({"boost": g.boost} if g.boost is not None else {}),
                            }
                            for g in t.groups
                        ],
                    }
                    for t in navigation.tabs
                    if not t.hidden
                ],
            }

        # The line above a docs page title (styling.eyebrows)
        if self.config.styling and "eyebrows" in self.config.styling.model_fields_set:
            result["styling"] = {"eyebrows": self.config.styling.eyebrows}

        # Page footer text and "Was this page helpful?" (per-page facts are in docs-nav.json)
        docs = self.config.content.docs if self.config.content else None
        if docs and (docs.edit_link or docs.feedback):
            result["pageFooter"] = {
                **({"editText": docs.edit_link.text} if docs.edit_link else {}),
                **({"feedbackIssues": docs.feedback.issues} if docs.feedback else {}),
            }

        # Docs home page layout (frontmatter `layout: home` on the docs index)
        docs_home = self._docs_home()
        if docs_home is not None:
            result["docsHome"] = docs_home

        # Logo
        if self.config.logo:
            result["logo"] = {
                "light": self.config.logo.light,
                "dark": self.config.logo.dark,
                "href": self.config.logo.href,
            }

        # Navbar
        if self.config.navbar:
            navbar_dict: dict = {}
            if self.config.navbar.primary:
                navbar_dict["primary"] = {
                    "type": self.config.navbar.primary.type,
                    "label": self.config.navbar.primary.label,
                    "href": self.config.navbar.primary.href,
                }
            if self.config.navbar.links:
                navbar_dict["links"] = [
                    {"label": lnk.label, "href": lnk.href} for lnk in self.config.navbar.links
                ]
            result["navbar"] = navbar_dict

        # Footer
        if self.config.footer:
            footer_dict: dict = {}
            if self.config.footer.socials:
                footer_dict["socials"] = self.config.footer.socials
            if self.config.footer.links:
                footer_dict["links"] = [
                    {
                        "header": col.header,
                        "items": [{"label": item.label, "href": item.href} for item in col.items],
                    }
                    for col in self.config.footer.links
                ]
            result["footer"] = footer_dict

        # Search
        if self.config.search:
            result["search"] = {
                "enabled": self.config.search.enabled,
                "provider": self.config.search.provider,
                **({"prompt": self.config.search.prompt} if self.config.search.prompt else {}),
                **({"maxResults": self.config.search.max_results} if self.config.search.max_results else {}),
            }

        # ── Enterprise features (partial implementation) ──

        # SEO configuration - basic implementation for static build
        if self.config.seo:
            result["seo"] = {
                "titleTemplate": self.config.seo.title_template,
                "defaultImage": self.config.seo.default_image,
                "twitter": self.config.seo.twitter,
                "siteUrl": (
                    self._site_url() if self.url_base else self.config.seo.site_url or self._site_url()
                ),
                "robots": self.config.seo.robots,
                "trailingSlash": self.config.seo.trailing_slash,
            }

        # A11y configuration - basic implementation for frontend
        if self.config.a11y:
            result["a11y"] = {
                "skipToContent": self.config.a11y.skip_to_content,
                "focusVisible": self.config.a11y.focus_visible,
                "reduceMotion": self.config.a11y.reduce_motion,
                "ariaLabels": self.config.a11y.aria_labels,
            }

        # I18n configuration - emit for frontend consumption
        if self.config.i18n:
            result["i18n"] = {
                "defaultLocale": self.config.i18n.default_locale,
                "locales": self.config.i18n.locales,
                "rtlLocales": self.config.i18n.rtl_locales,
                "fallbackLocale": self.config.i18n.fallback_locale,
                "translationsDir": self.config.i18n.translations_dir,
            }

        return result

    def _serialize_template(self, template) -> dict:
        """Serialize a template config including slots and zones."""
        result = {
            "layout": template.layout,
            "slots": {
                slot_name: (
                    {"ref": slot.ref}
                    if slot and slot.ref
                    else {"type": slot.type}
                    if slot and slot.type
                    else None
                )
                for slot_name, slot in template.slots.items()
            },
        }

        # Add zones if present (WordPress-style widget areas)
        zones_dict = {}
        if template.zones:
            zones_data = template.zones.model_dump(by_alias=True, exclude_none=True)
            for zone_name, widgets in zones_data.items():
                if widgets:
                    zones_dict[zone_name] = [
                        {"type": w.get("type"), "props": w.get("props", {})} for w in widgets
                    ]

        if zones_dict:
            result["zones"] = zones_dict

        return result


    def _docs_home(self) -> dict | None:
        """The docs home page layout from docs/index.md (or README.md) frontmatter."""
        if not self.config.content or not self.config.content.docs:
            return None
        docs_dir = self.base_path / self.config.content.docs.dir
        for name in ("index.md", "README.md"):
            index = docs_dir / name
            if index.is_file():
                scanner = DocsScanner(docs_dir=docs_dir)
                text = index.read_text(encoding="utf-8")
                return docs_home_from_frontmatter(scanner._extract_frontmatter(text))
        return None

    def _annotate_page_footer(self, nav: dict) -> None:
        """Last updated and edit links for the page footer (compiler/page_meta.py)."""
        from praisonaiui.compiler.page_meta import annotate_nav

        docs = self.config.content.docs
        annotate_nav(
            nav,
            self._resolve_md_source,
            self.base_path / docs.dir,
            edit_pattern=docs.edit_link.pattern if docs.edit_link else None,
            last_updated=docs.last_updated,
        )

    def _generate_docs_nav(self) -> dict:
        """Generate docs-nav.json content."""
        if not self.config.content or not self.config.content.docs:
            return {"items": []}

        docs_config = self.config.content.docs
        docs_dir = self.base_path / docs_config.dir

        nav_config = docs_config.nav or NavConfig()
        scanner = DocsScanner(
            docs_dir=docs_dir,
            include=docs_config.include,
            exclude=self._exclude_patterns(),
            index_files=docs_config.index_files,
            sort=nav_config.sort,
        )
        pages = scanner.scan()

        base, api = self.config.site.route_base_docs, self._api
        api_pages = [DocPage(path=Path(f"{p.slug}.md"), slug=p.slug, title=p.title, description=p.description,
                             hidden=p.hidden) for p in (api.pages if api else [])]
        extra = api.sidebar_extra(nav_config.mode == "manual") if api else []
        entries = manual_entries(api.config if api else self.config)
        if entries:
            builder = NavBuilder(pages + api_pages, base_path=base, directory=nav_config.directory)
            nav = builder.to_dict_grouped(entries + extra, docs_dir=docs_dir)
        else:
            nav = NavBuilder(pages, base_path=base, directory=nav_config.directory).to_dict()
            if api_pages:  # endpoint pages: where their spec is named, after the folders
                nav["items"] += NavBuilder(api_pages, base_path=base).to_dict_grouped(extra)["items"]
        apply_indexing(nav, self.config.seo.indexing if self.config.seo else "navigable")
        # Sidebar behaviour (docs/features/navigation.md): only what differs from the default.
        if not nav_config.collapsible:
            nav["collapsible"] = False
        if self.config.interaction and self.config.interaction.drilldown:
            nav["drilldown"] = True
        return nav

    def _exclude_patterns(self) -> list[str]:
        """``content.docs.exclude`` plus the lines of ``.aiuiignore`` next to the config."""
        docs = self.config.content.docs if self.config.content else None
        return [*(docs.exclude if docs else []), *read_ignore_file(self.base_path)]

    def _site_noindex(self) -> bool:
        """``seo.robots.index: false``: nothing on the site is indexed."""
        robots = self.config.seo.robots if self.config.seo else None
        return bool(robots) and not robots.get("index", True)

    def _robots_meta(self, noindex: bool) -> str:
        return robots_content(noindex, self.config.seo.robots if self.config.seo else None)

    def _custom_root_file(self, name: str) -> Path | None:
        """A hand-written ``robots.txt`` / ``sitemap.xml`` next to the config, published as is."""
        path = self.base_path / name
        return path if path.is_file() else None

    def _generate_route_manifest(self) -> dict:
        """Generate route-manifest.json content."""
        routes = []
        for i, route in enumerate(self.config.routes):
            route_entry = {
                "pattern": route.match,
                "template": route.template,
                "priority": len(self.config.routes) - i,  # First match = highest priority
            }
            if route.slots:
                route_entry["slotOverrides"] = {
                    name: (
                        {"ref": slot.ref}
                        if slot and slot.ref
                        else {"type": slot.type}
                        if slot and slot.type
                        else None
                    )
                    for name, slot in route.slots.items()
                }
            routes.append(route_entry)

        return {"routes": routes}

    def _api_reference(self, specs: dict):
        """Endpoint pages for the specs the config names (compiler/openapi_pages.py), or None."""
        docs = self.config.content.docs if self.config.content else None
        if not specs or not docs:
            return None
        scanner = DocsScanner(docs_dir=self.base_path / docs.dir, include=docs.include,
                              exclude=self._exclude_patterns(), index_files=docs.index_files)
        return build_api_reference(self.config, specs, {p.slug for p in scanner.scan()})

    def _write_api_specs(self, output_dir: Path, specs: dict, indent: int | None) -> list[str]:
        """Each spec bundled into ``openapi/<slug>.json`` (``x-excluded`` operations
        removed), listed in ``openapi/index.json``, ``llms.txt`` and the RFC 9727
        ``/.well-known/api-catalog``."""
        self._spec_files = []
        if not specs:
            return []
        (output_dir / "openapi").mkdir(parents=True, exist_ok=True)
        index = [{
            "source": s.source, "file": f"openapi/{s.slug}.json", "title": s.title,
            "openapi": s.openapi, "version": (s.document.get("info") or {}).get("version"),
            "operations": sum(1 for op in s.operations if not op.excluded),
        } for s in specs.values()]
        for spec, entry in zip(specs.values(), index):
            self._write_json(output_dir / entry["file"], strip_excluded(spec.bundled), indent)
        self._write_json(output_dir / "openapi/index.json", {"specs": index}, indent)
        self._spec_files = [(e["title"], e["file"]) for e in index]
        docs = {s.spec.source: next((p.slug for p in s.pages if not p.hidden), None)
                for s in self._api.sections} if self._api else {}
        base = self.config.site.route_base_docs.rstrip("/")
        catalog = api_catalog(self._absolute_url("/.well-known/api-catalog"), [
            (s, self._absolute_url(f"/{e['file']}"),
             self._page_url(f"{base}/{docs[s.source]}") if docs.get(s.source) else None)
            for s, e in zip(specs.values(), index)])
        (output_dir / ".well-known").mkdir(exist_ok=True)
        self._write_json(output_dir / ".well-known/api-catalog", catalog, indent)
        return [e["file"] for e in index] + ["openapi/index.json", ".well-known/api-catalog"]

    def _write_json(self, path: Path, data: dict, indent: int | None) -> None:
        """Write JSON data to file."""
        path.write_text(
            json.dumps(data, indent=indent, ensure_ascii=False), encoding="utf-8"
        )

    @staticmethod
    def _frontend_dirs() -> tuple[Path, Path]:
        """Return ``(build_dir, packaged_dir)`` for the frontend templates.

        ``build_dir`` holds the Vite build (index.html, assets/). It is the
        packaged ``templates/frontend`` unless ``AIUI_TEMPLATES_DIR`` points at
        another build (the same override the server honours), for example one
        copied with ``node scripts/sync-templates.mjs --dest <dir>``.
        """
        import os

        packaged = Path(__file__).parent.parent / "templates" / "frontend"
        override = os.environ.get("AIUI_TEMPLATES_DIR", "").strip()
        if override:
            return Path(override).expanduser().resolve(), packaged
        return packaged, packaged

    def _copy_viewer(self, output_dir: Path) -> None:
        """Copy frontend bundle to output directory."""
        import shutil

        frontend_dir, packaged_dir = self._frontend_dirs()

        if frontend_dir.exists():
            # Copy index.html and patch anti-flicker for darkMode
            shutil.copy(
                frontend_dir / "index.html",
                output_dir / "index.html",
            )
            self._patch_antiflicker(output_dir / "index.html")
            # Copy plugins directory and generate plugins.json. A build-only
            # AIUI_TEMPLATES_DIR has no plugins/: use the packaged ones. Their
            # version goes on the loader's URL (it imports them with it).
            plugins_root = frontend_dir if (frontend_dir / "plugins").is_dir() else packaged_dir
            plugins_version = self._copy_plugins(output_dir, plugins_root)
            self._patch_static_shell(output_dir / "index.html", plugins_version)
            # Copy assets folder if exists
            assets_src = frontend_dir / "assets"
            if assets_src.exists():
                assets_dst = output_dir / "assets"
                if assets_dst.exists():
                    shutil.rmtree(assets_dst)
                shutil.copytree(assets_src, assets_dst)
            # index.js and index.css keep fixed names (their chunks are
            # content-hashed), so give them a content hash in the URL. Must run
            # before 404.html and the per-route pages are copied from index.html.
            self._patch_asset_versions(
                output_dir / "index.html",
                output_dir / "assets",
                version_entry=(frontend_dir / "aiui-manifest.json").is_file(),
            )
            self._patch_url_base(output_dir / "index.html")
            # Create 404.html as a copy of patched index.html
            # for SPA routing on static hosts like GitHub Pages
            not_found = output_dir / "404.html"
            html = (output_dir / "index.html").read_text(encoding="utf-8")
            not_found.write_text(set_robots_meta(html, "noindex"), encoding="utf-8")
            # Copy root-level static files (icons, favicons, etc.)
            static_exts = {
                ".svg",
                ".png",
                ".ico",
                ".webmanifest",
                ".txt",
            }
            for f in frontend_dir.iterdir():
                if f.is_file() and f.suffix in static_exts:
                    shutil.copy(f, output_dir / f.name)
            # The Vite manifest lists every file of this build. A deploy step
            # reads the previous site's copy to carry old hashed chunks forward
            # for one release (see scripts/carry-forward-assets.mjs).
            build_manifest = frontend_dir / "aiui-manifest.json"
            if build_manifest.is_file():
                shutil.copy(build_manifest, output_dir / build_manifest.name)


    _ENTRY_ASSET_RE = re.compile(
        r"""(?P<attr>\b(?:src|href)=)(?P<q>["'])/assets/(?P<name>index\.(?:js|css))(?:\?[^"']*)?(?P=q)"""
    )

    def _patch_asset_versions(
        self, html_path: Path, assets_dir: Path, *, version_entry: bool = True
    ) -> None:
        """Rewrite ``/assets/index.js`` and ``/assets/index.css`` in index.html
        to ``...?v=<first 10 hex of the file's sha256>``.

        Both files have fixed names, so a static host would otherwise serve a
        stale copy from cache after a deploy while the hashed chunks they
        import have changed. A missing file leaves its reference untouched.

        ``version_entry=False`` leaves index.js alone. That is for bundles
        built before chunks were hashed (no ``aiui-manifest.json``): their
        chunks import ``./index.js``, which is a different module URL from
        ``index.js?v=...``, so the entry would be evaluated twice.
        """
        import hashlib

        if not html_path.is_file():
            return

        def versioned(match: re.Match[str]) -> str:
            asset = assets_dir / match.group("name")
            if not asset.is_file():
                return match.group(0)
            if asset.suffix == ".js" and not version_entry:
                return match.group(0)
            digest = hashlib.sha256(asset.read_bytes()).hexdigest()[:10]
            q = match.group("q")
            return f"{match.group('attr')}{q}/assets/{match.group('name')}?v={digest}{q}"

        html = html_path.read_text(encoding="utf-8")
        patched = self._ENTRY_ASSET_RE.sub(versioned, html)
        if patched != html:
            html_path.write_text(patched, encoding="utf-8")

    def _color_mode(self) -> str:
        """``site.theme.mode`` (light, dark or system), else from ``darkMode``."""
        theme = self.config.site.theme
        mode = theme.mode if theme else None
        if mode is None:
            mode = "dark" if (theme.dark_mode if theme else True) else "light"
        return mode

    def _patch_antiflicker(self, html_path: Path) -> None:
        """Patch the theme bootstrap in index.html.

        The default colour mode is ``site.theme.mode`` (``system`` follows the
        OS), else ``darkMode``. Preset ``paper`` also marks ``<html>`` with
        ``data-aiui-look="paper"``, which assets/theme.css paints from the
        first frame (themes.get_paper_first_paint_css).
        """
        from praisonaiui.themes import PAPER_LOOK

        theme = self.config.site.theme
        mode = self._color_mode()
        dark_default = {
            "dark": "true",
            "light": "false",
            "system": "matchMedia('(prefers-color-scheme: dark)').matches",
        }[mode]
        html = html_path.read_text(encoding="utf-8")
        html = html.replace("__AIUI_DARK_DEFAULT__", dark_default)
        if theme and theme.preset == PAPER_LOOK and "data-aiui-look=" not in html:
            html = re.sub(r"<html\b", f'<html data-aiui-look="{PAPER_LOOK}"', html, count=1)
        html_path.write_text(html, encoding="utf-8")

    _ROOT_URL_RE = re.compile(r"""(\s(?:src|href)=)(["'])/(?!/)""")

    def _patch_url_base(self, html_path: Path) -> None:
        """Under a base path, prefix the shell's root-absolute ``src``/``href``
        URLs (assets, icon, plugin loader, sitemap) and tell the app the base
        with ``<meta name="aiui-base">`` (src/frontend/src/lib/url.ts). The
        per-route pages copy this file, and their own links go through
        ``_absolute_url``. No base: the file is left as it is."""
        if not self.url_base or not html_path.is_file():
            return
        html = html_path.read_text(encoding="utf-8")
        html = self._ROOT_URL_RE.sub(rf"\1\2{self.url_base}/", html)
        html = html.replace(
            "<head>", f'<head>\n  <meta name="aiui-base" content="{self.url_base}" />', 1
        )
        html_path.write_text(html, encoding="utf-8")

    _LOADER_RE = re.compile(r"""(/plugins/plugin-loader\.js)(?:\?[^"']*)?(["'])""")

    def _patch_static_shell(self, html_path: Path, plugins_version: str = "") -> None:
        """Patch built index.html for static hosts (GitHub Pages).

        - Strip trailing slashes from the URL bar before React hydrates.
        - Load plugin-loader.js (not included in the Vite bundle), as
          ``plugin-loader.js?v=<plugins_version>``: the loader imports every
          plugin with that ``?v=``, so a build's plugins are cached and the
          next build's are not mistaken for them.
        """
        html = html_path.read_text(encoding="utf-8")
        canonical_script = (
            '<script id="aiui-canonical-url">'
            "(function(){var p=location.pathname.replace(/\\/+$/, '')||'/';"
            "if(p!==location.pathname){history.replaceState(null,'',"
            "p+location.search+location.hash);}})();"
            "</script>"
        )
        if 'id="aiui-canonical-url"' not in html and not self._trailing_slash():
            html = html.replace("<head>", f"<head>\n  {canonical_script}", 1)
        if 'rel="sitemap"' not in html:
            html = html.replace(
                "<head>",
                '<head>\n  <link rel="sitemap" type="application/xml" href="/sitemap.xml" />',
                1,
            )
        if "plugin-loader.js" not in html:
            html = html.replace(
                "</body>",
                '  <script src="/plugins/plugin-loader.js"></script>\n</body>',
            )
        if plugins_version:
            html = self._LOADER_RE.sub(rf"\1?v={plugins_version}\2", html)
        html_path.write_text(html, encoding="utf-8")

    def _copy_plugins(self, output_dir: Path, frontend_dir: Path) -> str:
        """Copy frontend plugins and generate plugins.json config.

        Returns the plugins' version: the first 10 hex of a sha256 over the
        copied files' names and bytes ("" when there is no plugins folder).
        plugins.json carries it as ``version`` too.
        """
        import hashlib
        import shutil

        plugins_src = frontend_dir / "plugins"
        if not plugins_src.exists():
            return ""

        plugins_dst = output_dir / "plugins"
        if plugins_dst.exists():
            shutil.rmtree(plugins_dst)
        plugins_dst.mkdir(parents=True)

        # Always copy the plugin loader (core infrastructure)
        loader = plugins_src / "plugin-loader.js"
        if loader.exists():
            shutil.copy(loader, plugins_dst / "plugin-loader.js")

        # Get enabled plugins from site config
        enabled_plugins = []
        if self.config.site and hasattr(self.config.site, "plugins"):
            enabled_plugins = list(self.config.site.plugins)

        # Copy each enabled plugin file
        for plugin_name in enabled_plugins:
            plugin_file = plugins_src / f"{plugin_name}.js"
            if plugin_file.exists():
                shutil.copy(plugin_file, plugins_dst / plugin_file.name)

        # Generate plugins.json (consumed by plugin-loader.js)
        # fetch-retry must load first to intercept fetches
        ordered = []
        if "fetch-retry" in enabled_plugins:
            ordered.append("fetch-retry")
        for p in enabled_plugins:
            if p != "fetch-retry":
                ordered.append(p)

        digest = hashlib.sha256()
        for f in sorted(plugins_dst.glob("*.js")):
            digest.update(f.name.encode("utf-8") + b"\0" + f.read_bytes())
        version = digest.hexdigest()[:10]

        plugins_config = {"plugins": ordered, "version": version}
        (plugins_dst / "plugins.json").write_text(
            json.dumps(plugins_config, indent=2), encoding="utf-8"
        )
        return version

    def _generate_route_pages(self, output_dir: Path, nav: dict) -> list[str]:
        """Generate per-route HTML files for SPA fallback and SEO.

        For each page in the docs navigation, creates a flat HTML file at
        the route path (e.g. _site/docs/concepts/configuration.html).
        GitHub Pages serves /docs/concepts/configuration from that file
        without appending a trailing slash. A copy at
        <route>/index.html serves hosts without that mapping.
        Each file is a copy of the SPA shell with page-specific:
          - <title> tag
          - <meta name="description">
          - <link rel="canonical">
          - Open Graph tags (og:title, og:description, og:url)
          - Pre-rendered markdown content in <noscript> for SEO crawlers
        """

        template_path = output_dir / "index.html"
        if not template_path.exists():
            return []

        template_html = template_path.read_text(encoding="utf-8")
        site_title = self.config.site.title
        site_desc = self.config.site.description or f"Documentation built with {site_title}"
        files: list[str] = []

        # Collect all pages from nav (including nested children)
        pages = self._collect_nav_pages(nav)
        home_path = self._docs_home_path(nav)
        hero_preload = self._hero_preload(nav)
        trails = nav_trails(nav)

        for page in pages:
            path = page["path"]  # e.g. "/docs/concepts/configuration"
            title = page["title"]  # e.g. "YAML Configuration"

            # Build file system path — flat .html file so static hosts (GitHub Pages)
            # serve /docs/testing without a trailing-slash redirect.
            relative = path.lstrip("/")
            page_file = output_dir / f"{relative}.html"
            page_file.parent.mkdir(parents=True, exist_ok=True)

            # Build page-specific HTML
            page_title = f"{title} | {site_title}"
            page_desc = page.get("description") or f"{title} - {site_desc}"
            page_noindex = bool(page.get("noindex"))

            html = template_html

            # Replace <title>
            html = html.replace(
                "<title>Documentation</title>",
                f"<title>{self._escape_html(page_title)}</title>",
            )

            # Replace meta description
            html = html.replace(
                'content="Documentation built with PraisonAIUI"',
                f'content="{self._escape_html(page_desc)}"',
            )

            # Add canonical URL, OG tags, and noscript content before </head>
            html = set_robots_meta(html, self._robots_meta(page_noindex))
            seo_tags = self._build_seo_tags(path, page_title, page_desc)
            json_ld = self._build_json_ld(path, title, page_desc, trails.get(path, []))

            # Try to load markdown content for noscript pre-rendering
            noscript_content = self._get_noscript_content(output_dir, path)
            crawl_nav = self._build_crawl_nav_html(nav)
            noscript_block = crawl_nav
            if noscript_content:
                noscript_block += noscript_content

            # Inject SEO tags (and, on the docs home, the hero preload) before </head>
            head_extra = f"\n{hero_preload}" if hero_preload and path.rstrip("/") == home_path else ""
            html = html.replace(
                "</head>",
                f"{seo_tags}\n{self._markdown_link(path)}\n{json_ld}{head_extra}\n</head>",
            )

            # Inject noscript crawl content inside <div id="root">, and the page's
            # markdown after it (docs/docLoader.ts adoptInlinedDoc)
            html = html.replace(
                '<div id="root"></div>',
                f'<div id="root"><noscript>{noscript_block}</noscript></div>'
                + self._inline_doc_script(output_dir, path),
            )

            page_file.write_text(html, encoding="utf-8")
            files.append(f"{relative}.html")
            # Hosts that do not map /x to x.html (S3, `python -m http.server`)
            # serve /x/ from x/index.html; the canonical-URL script then drops
            # the slash. GitHub Pages and Netlify still answer /x with x.html.
            dir_index = output_dir / relative / "index.html"
            if not dir_index.exists():
                dir_index.parent.mkdir(parents=True, exist_ok=True)
                dir_index.write_text(html, encoding="utf-8")
                files.append(f"{relative}/index.html")

        return files

    def _collect_nav_pages(self, nav: dict) -> list[dict]:
        """Recursively collect all pages from docs-nav.json."""
        pages: list[dict] = []

        def walk(items: list[dict]) -> None:
            for item in items:
                if item.get("path"):
                    pages.append(
                        {
                            "path": item["path"],
                            # The page's own title (the sidebar may show a shorter nav_title)
                            "title": item.get("pageTitle") or item.get("title", ""),
                            "description": item.get("description", ""),
                            "noindex": bool(item.get("noindex")),
                            "hidden": bool(item.get("hidden")),
                            "searchable": item.get("searchable") is not False,
                        }
                    )
                if item.get("children"):
                    walk(item["children"])

        walk(nav.get("items", []))
        return pages

    def _site_url(self) -> str | None:
        """The site's public URL, with the base path (``https://u.github.io/repo``)."""
        site = self._origin_url()
        if site and self.url_base and not site.endswith(self.url_base):
            site += self.url_base
        return site

    def _origin_url(self) -> str | None:
        if self.config.seo and self.config.seo.site_url:
            return self.config.seo.site_url.rstrip("/")
        for candidate in (self.base_path / "CNAME", self.base_path / "docs" / "CNAME"):
            if candidate.exists():
                domain = candidate.read_text(encoding="utf-8").strip()
                if domain and "." in domain:
                    return f"https://{domain.rstrip('/')}"
        return self._inferred_site_url

    def _public_path(self, path: str) -> str:
        """The URL a page is published at: the docs home (`/docs`, `/docs/index`) is the site root."""
        base = self.config.site.route_base_docs.rstrip("/")
        trimmed = path.rstrip("/") or "/"
        if trimmed in (base, f"{base}/index"):
            return "/"
        return path

    def _trailing_slash(self) -> bool:
        return bool(self.config.seo and self.config.seo.trailing_slash)

    def _page_url(self, path: str) -> str:
        """A page's absolute URL, ending in ``/`` with ``seo.trailingSlash`` (canonical, sitemap, llms)."""
        url = self._absolute_url(path)
        return with_slash(url) if self._trailing_slash() else url

    def _absolute_url(self, path: str) -> str:
        path = self._public_path(path)
        site = self._site_url()
        if not site:
            return f"{self.url_base}{path}" if path.startswith("/") else path
        if not path.startswith("/"):
            path = f"/{path}"
        return f"{site}{path}"

    def _md_url(self, path: str) -> str:
        """The URL of a page's agent-ready Markdown (``https://site/docs/guide.md``)."""
        return (self._site_url() or self.url_base) + am.page_md_path(path, self.config.site.route_base_docs)

    def _agent_markdown(self, src: Path, title: str, description: str, instructions: bool = True) -> str:
        """``src`` (a file in the docs folder) as agent-ready Markdown (compiler/agent_markdown.py)."""
        base = self.config.site.route_base_docs.rstrip("/")
        try:
            folder = src.parent.relative_to(self.base_path / self.config.content.docs.dir).as_posix()
        except ValueError:  # an endpoint page (openapi_pages.py): its links are absolute
            folder = "."
        markdown = self.config.markdown
        return am.to_agent_markdown(
            src.read_text(encoding="utf-8"), title=title, description=description,
            page_dir=f"{base}/{folder}".removesuffix("/.") or "/", docs_base=base or "/",
            site=self._site_url() or self.url_base,
            instructions=markdown.instructions if markdown and instructions else None,
        )

    def _generate_sitemap(self, output_dir: Path, nav: dict) -> list[str]:
        """sitemap.xml: every indexable page. A ``sitemap.xml`` next to the config
        is published instead; with ``seo.robots.index: false`` there is none."""
        custom = self._custom_root_file("sitemap.xml")
        if custom:
            (output_dir / "sitemap.xml").write_bytes(custom.read_bytes())
            return ["sitemap.xml"]
        if self._site_noindex():
            (output_dir / "sitemap.xml").unlink(missing_ok=True)
            return []
        site = self._site_url()
        if not site:
            return []

        urls = []
        pages = self._collect_nav_pages(nav)
        home = self._docs_home_path(nav)
        if not any(p["noindex"] and p["path"].rstrip("/") == home for p in pages):
            root_lastmod = self._format_lastmod(self.base_path / "docs" / "index.md")
            urls.append(self._sitemap_url_entry(self._absolute_url("/"), root_lastmod))
        for page in pages:
            if page.get("noindex"):
                continue
            path = page["path"].rstrip("/") or "/"
            if self._public_path(path) == "/":
                continue  # the docs home is the site root, listed above
            loc = self._page_url(path)
            lastmod = self._format_lastmod(self._resolve_md_source(path))
            urls.append(self._sitemap_url_entry(loc, lastmod))

        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(urls)
            + "\n</urlset>\n"
        )
        (output_dir / "sitemap.xml").write_text(xml, encoding="utf-8")
        return ["sitemap.xml"]

    @staticmethod
    def _sitemap_url_entry(loc: str, lastmod: str | None) -> str:
        safe_loc = Compiler._escape_html(loc)
        if lastmod:
            return f"  <url><loc>{safe_loc}</loc><lastmod>{lastmod}</lastmod></url>"
        return f"  <url><loc>{safe_loc}</loc></url>"

    @staticmethod
    def _format_lastmod(path: Path | None) -> str | None:
        if not path or not path.is_file():
            return None
        from datetime import datetime, timezone

        mtime = path.stat().st_mtime
        return datetime.fromtimestamp(mtime, tz=timezone.utc).strftime("%Y-%m-%d")

    def _resolve_md_source(self, route_path: str) -> Path | None:
        """Map a docs route path to its source markdown file."""
        if not self.config.content or not self.config.content.docs:
            return None

        base = self.config.site.route_base_docs.rstrip("/")
        if not route_path.startswith(base):
            return None

        if route_path.rstrip("/") in self._api_sources:
            return self._api_sources[route_path.rstrip("/")]
        rel = route_path[len(base) :].lstrip("/")
        docs_dir = self.base_path / self.config.content.docs.dir
        index_files = ["index.md", "index.mdx", "README.md", *self.config.content.docs.index_files]
        candidates = [docs_dir / f"{rel}.md", docs_dir / f"{rel}.mdx", *(docs_dir / rel / n for n in index_files)]
        if rel in ("", "index"):
            candidates[:0] = [docs_dir / "index.md", docs_dir / "index.mdx", *(docs_dir / n for n in index_files)]

        for candidate in candidates:
            if candidate.is_file():
                return candidate
        return None

    def _generate_robots(self, output_dir: Path) -> list[str]:
        """robots.txt. A ``robots.txt`` next to the config is published instead.

        ``seo.robots.follow`` is a page-level hint (the robots meta); robots.txt
        cannot say it, so it no longer blocks ``/docs/``.
        """
        custom = self._custom_root_file("robots.txt")
        if custom:
            (output_dir / "robots.txt").write_bytes(custom.read_bytes())
            return ["robots.txt"]
        noindex = self._site_noindex()
        lines = ["User-agent: *", "Disallow: /" if noindex else "Allow: /"]
        signal = content_signal(
            self.config.seo.content_signals.model_dump() if self.config.seo and self.config.seo.content_signals else None
        )
        if signal and not noindex:
            lines.append(signal)

        site = self._site_url()
        if site and not noindex:
            lines.append(f"Sitemap: {site}/sitemap.xml")
            lines.append(f"# LLM index: {site}/llms.txt")

        (output_dir / "robots.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        return ["robots.txt"]

    def _generate_search_index(self, output_dir: Path, nav: dict) -> list[str]:
        """Write ``search-index.json``: every page's headings and text for the
        docs search dialog (compiler/search_index.py). ``noindex`` pages (and
        hidden ones, see publish.apply_indexing) are left out, as from the sitemap,
        and so are ``searchable: false`` pages."""
        from praisonaiui.compiler.search_index import page_entry

        if self.config.search and self.config.search.enabled is False:
            return []
        scanner = DocsScanner(docs_dir=self.base_path)
        pages = []
        for page in self._collect_nav_pages(nav):
            if page["noindex"] or not page["searchable"]:
                continue
            md_path = self._resolve_md_source(page["path"])
            text = md_path.read_text(encoding="utf-8") if md_path else ""
            meta = scanner._extract_frontmatter(text)
            body = am.visibility(self._strip_frontmatter(text), "humans")
            pages.append(page_entry(page["path"], page["title"], page["description"], body, meta))
        if not pages:
            return []
        # Compact: the dialog downloads it once, on first open.
        (output_dir / "search-index.json").write_text(
            json.dumps({"version": 1, "pages": pages}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        return ["search-index.json"]

    @staticmethod
    def _strip_frontmatter(content: str) -> str:
        if content.startswith("---"):
            end_idx = content.find("---", 3)
            if end_idx != -1:
                return content[end_idx + 3 :].lstrip("\n")
        return content

    def _patch_homepage_seo(self, output_dir: Path, nav: dict) -> None:
        """Add canonical and crawl hints to root index.html."""
        index_path = output_dir / "index.html"
        if not index_path.exists():
            return

        docs_home = self._docs_home_path(nav)

        site_title = self.config.site.title
        site_desc = self.config.site.description or f"Documentation for {site_title}"
        page_title = f"{site_title}"
        seo_tags = self._build_seo_tags(docs_home, page_title, site_desc)
        crawl_nav = self._build_crawl_nav_html(nav)

        html = index_path.read_text(encoding="utf-8")
        html = html.replace(
            "<title>Documentation</title>",
            f"<title>{self._escape_html(page_title)}</title>",
        )
        html = html.replace(
            'content="Documentation built with PraisonAIUI"',
            f'content="{self._escape_html(site_desc)}"',
        )
        if "</head>" in html and 'rel="canonical"' not in html:
            html = html.replace("</head>", f"{seo_tags}\n{self._markdown_link(docs_home)}\n</head>", 1)
        home_noindex = any(
            p["noindex"] and p["path"].rstrip("/") == docs_home for p in self._collect_nav_pages(nav)
        )
        html = set_robots_meta(html, self._robots_meta(home_noindex))
        preload = self._hero_preload(nav)
        if preload and 'rel="preload" as="image"' not in html:
            html = html.replace("</head>", f"{preload}\n</head>", 1)
        if '<div id="root"></div>' in html:
            html = html.replace(
                '<div id="root"></div>',
                f'<div id="root"><noscript>{crawl_nav}</noscript></div>'
                + self._inline_doc_script(output_dir, docs_home),
            )
        index_path.write_text(html, encoding="utf-8")

    def _docs_home_path(self, nav: dict) -> str:
        """The route of the docs home page (``/docs/index`` unless the nav names another)."""
        for page in self._collect_nav_pages(nav):
            if page["path"].rstrip("/").endswith("/docs/index") or page["path"] == "/docs/index":
                return page["path"].rstrip("/") or "/docs/index"
        return "/docs/index"

    def _hero_preload(self, nav: dict) -> str:
        """Preload tags for the docs home hero image (docs_home.hero_preload_tags)."""
        from praisonaiui.compiler.docs_home import hero_preload_tags

        tags = hero_preload_tags(self._docs_home(), self._docs_home_path(nav), self._color_mode())
        return self._ROOT_URL_RE.sub(rf"\1\2{self.url_base}/", tags) if self.url_base else tags

    def _build_crawl_nav_html(self, nav: dict) -> str:
        """Static nav links for non-JS crawlers."""
        links: list[str] = []
        for page in self._collect_nav_pages(nav):
            if page["hidden"]:
                continue
            path = page["path"].rstrip("/") or "/"
            title = self._escape_html(page["title"])
            url = self._escape_html(self._page_url(path))
            links.append(f'<li><a href="{url}">{title}</a></li>')

        if not links:
            return ""

        return (
            '<nav aria-label="Documentation">'
            f'<ul>{"".join(links)}</ul>'
            "</nav>"
        )

    def _build_seo_tags(self, path: str, title: str, description: str) -> str:
        """Build canonical, OG, and Twitter meta tags (the robots meta: publish.set_robots_meta)."""
        d = self._escape_html(description)
        canonical = self._escape_html(self._page_url(path))
        og_url = canonical

        # Extract original page title by removing the site title suffix if present
        site_title = self.config.site.title
        page_title = title
        suffix = f" | {site_title}"
        if page_title.endswith(suffix):
            page_title = page_title[:-len(suffix)]

        # Use configured title template if available
        if self.config.seo and self.config.seo.title_template:
            template = self.config.seo.title_template
            if "%s" in template:
                parts = template.split("%s")
                if len(parts) >= 3:
                    t = self._escape_html(f"{parts[0]}{page_title}{parts[1]}{site_title}{''.join(parts[2:])}")
                else:
                    t = self._escape_html(template.replace("%s", page_title, 1))
            else:
                t = self._escape_html(template)
        else:
            t = self._escape_html(title)

        tags = [
            f'  <link rel="canonical" href="{canonical}" />',
            f'  <meta property="og:title" content="{t}" />',
            f'  <meta property="og:description" content="{d}" />',
            f'  <meta property="og:url" content="{og_url}" />',
            '  <meta property="og:type" content="article" />',
        ]

        # Add default OG image if configured
        if self.config.seo and self.config.seo.default_image:
            image = self.config.seo.default_image
            if not image.startswith(("http://", "https://")):
                image = self._absolute_url(image)
            og_image = self._escape_html(image)
            tags.append(f'  <meta property="og:image" content="{og_image}" />')

        # Add Twitter card tags
        tags.append('  <meta name="twitter:card" content="summary" />')
        tags.append(f'  <meta name="twitter:title" content="{t}" />')
        tags.append(f'  <meta name="twitter:description" content="{d}" />')

        # Add Twitter handle if configured
        if self.config.seo and self.config.seo.twitter and "handle" in self.config.seo.twitter:
            handle = self._escape_html(self.config.seo.twitter["handle"])
            tags.append(f'  <meta name="twitter:site" content="{handle}" />')

        return "\n".join(tags)

    def _markdown_link(self, path: str) -> str:
        """``<link rel="alternate" type="text/markdown">``: where an agent finds the page as Markdown."""
        href = self._escape_html(self._md_url(path))
        return f'  <link rel="alternate" type="text/markdown" href="{href}" />'

    def _build_json_ld(self, path: str, title: str, description: str, trail: list[dict] | tuple = ()) -> str:
        url = self._page_url(path)
        site_url = self._site_url()
        payload: dict = {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "headline": title,
            "description": description,
            "url": url,
        }
        if site_url:
            payload["isPartOf"] = {
                "@type": "WebSite",
                "name": self.config.site.title,
                "url": f"{site_url}/",
            }
        script = f'  <script type="application/ld+json">{json_for_html(payload, separators=None)}</script>'
        # BreadcrumbList: the page's groups that have a page of their own, then the page.
        crumbs = [(c["title"], self._page_url(c["path"])) for c in trail if c.get("path")]
        if crumbs:
            items = [{"@type": "ListItem", "position": i, "name": name, "item": item}
                     for i, (name, item) in enumerate([*crumbs, (title, url)], 1)]
            crumbs_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": items}
            script += f'\n  <script type="application/ld+json">{json_for_html(crumbs_ld, separators=None)}</script>'
        return script

    # The JSON script docs/docLoader.ts adoptInlinedDoc() reads.
    INITIAL_DOC_ID = "aiui-initial-doc"
    # Largest page inlined; a bigger one is fetched as before.
    INITIAL_DOC_MAX_BYTES = 200_000

    def _inline_doc_script(self, output_dir: Path, path: str) -> str:
        """The page's published markdown as a JSON script, so it renders without a request.

        The URL is the file ``aiui build`` publishes next to the page; the
        loader uses the text only when the app asks for that same URL. ``<``,
        ``>`` and ``&`` are escaped so the text can never close the tag.
        """
        relative = path.strip("/")
        for candidate in (output_dir / f"{relative}{am.SOURCE_SUFFIX}", output_dir / relative / f"index{am.SOURCE_SUFFIX}"):
            if candidate.is_file() and candidate.stat().st_size <= self.INITIAL_DOC_MAX_BYTES:
                url = "/" + candidate.relative_to(output_dir).as_posix()
                text = candidate.read_text(encoding="utf-8")
                payload = json_for_html({"url": url, "text": text}, separators=None)
                return f'<script type="application/json" id="{self.INITIAL_DOC_ID}">{payload}</script>'
        return ""

    def _get_noscript_content(self, output_dir: Path, path: str) -> str:
        """Load markdown file and convert to simple HTML for noscript block."""
        # Try to find the corresponding markdown file
        relative = path.lstrip("/")
        md_candidates = [
            output_dir / f"{relative}{am.SOURCE_SUFFIX}",
            output_dir / relative / f"index{am.SOURCE_SUFFIX}",
        ]

        md_content = None
        for candidate in md_candidates:
            if candidate.exists():
                md_content = candidate.read_text(encoding="utf-8")
                break

        if not md_content:
            return ""

        # Simple markdown-to-HTML conversion for SEO (headings, paragraphs, lists)
        return self._simple_md_to_html(md_content)

    @staticmethod
    def _simple_md_to_html(md: str) -> str:
        """Minimal markdown to HTML for noscript SEO content."""
        lines = md.split("\n")
        result: list[str] = []
        in_code = False
        in_frontmatter = False
        frontmatter_seen = False

        for line in lines:
            stripped = line.strip()

            # Skip frontmatter block (between first pair of --- markers)
            if stripped == "---" and not frontmatter_seen:
                if not in_frontmatter:
                    in_frontmatter = True
                    continue
                else:
                    in_frontmatter = False
                    frontmatter_seen = True
                    continue
            if in_frontmatter:
                continue

            # Code blocks
            if stripped.startswith("```"):
                in_code = not in_code
                continue
            if in_code:
                continue

            # Headings
            hm = re.match(r"^(#{1,6})\s+(.+)", stripped)
            if hm:
                level = len(hm.group(1))
                text = hm.group(2)
                result.append(f"<h{level}>{text}</h{level}>")
                continue

            # Empty lines
            if not stripped:
                continue

            # List items
            if re.match(r"^[-*+]\s+", stripped):
                text = re.sub(r"^[-*+]\s+", "", stripped)
                result.append(f"<li>{Compiler._inline_md_to_html(text)}</li>")
                continue

            # Paragraphs
            result.append(f"<p>{Compiler._inline_md_to_html(stripped)}</p>")

        return "\n".join(result)

    @staticmethod
    def _inline_md_to_html(text: str) -> str:
        """Convert inline markdown (links, emphasis) for noscript HTML."""
        escaped = (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

        def link_repl(match: re.Match[str]) -> str:
            label = match.group(1)
            href = match.group(2)
            if href.startswith("/") or href.startswith("http://") or href.startswith("https://"):
                safe_href = href.replace('"', "&quot;")
                return f'<a href="{safe_href}">{label}</a>'
            return label

        escaped = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link_repl, escaped)
        escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
        escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
        return escaped

    @staticmethod
    def _escape_html(text: str) -> str:
        """Escape HTML special characters for meta tags."""
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )

    def _copy_docs(self, output_dir: Path) -> list[str]:
        """Copy markdown docs to output directory for content loading."""
        import shutil

        if not self.config.content or not self.config.content.docs:
            return []

        docs_config = self.config.content.docs
        docs_dir = self.base_path / docs_config.dir

        if not docs_dir.exists():
            return []

        # Create output docs directory
        docs_output = output_dir / "docs"
        if docs_output.exists():
            shutil.rmtree(docs_output)

        # Copy the docs folder, less what content.docs.exclude and .aiuiignore
        # leave out: an excluded draft is never published, page or asset.
        patterns = self._exclude_patterns()
        self._excluded = []

        def ignore(folder: str, names: list[str]) -> set[str]:
            rel_dir = Path(folder).relative_to(docs_dir).as_posix()
            skipped = set()
            for name in names:
                rel = name if rel_dir == "." else f"{rel_dir}/{name}"
                if is_excluded(rel, patterns):
                    skipped.add(name)
                    self._excluded.append(rel + ("/" if (Path(folder) / name).is_dir() else ""))
            return skipped

        shutil.copytree(docs_dir, docs_output, ignore=ignore if patterns else None)
        for rel in self._excluded:  # a folder left empty by the exclude goes too
            folder = (docs_output / rel.rstrip("/")).parent
            while folder != docs_output and folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
                folder = folder.parent

        # The client fetches a page's markdown at `<route>.md`. A page whose
        # route differs from its file (`typescript/index.md` -> /docs/typescript,
        # `adr/0001-x.md` -> /docs/adr/x) also gets a copy at its route, so a
        # static host with no server logic finds it.
        route_dir = output_dir / self.config.site.route_base_docs.strip("/")
        scanner = DocsScanner(
            docs_dir=docs_dir,
            include=docs_config.include,
            exclude=patterns,
            index_files=docs_config.index_files,
        )
        # The browser renders the source (`<route>.source.md`); `<route>.md`,
        # and the copy of the page's own file, are the agent-ready Markdown.
        for page in scanner.scan():
            if external_url(page.frontmatter):  # a sidebar link elsewhere: nothing to publish
                (docs_output / page.path.relative_to(docs_dir)).unlink(missing_ok=True)
                continue
            md = route_dir / am.page_md_path(f"/{page.slug}", "/").lstrip("/")
            md.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(page.path, md.with_name(md.name[: -len(".md")] + am.SOURCE_SUFFIX))
            text = self._agent_markdown(page.path, page.title, page.description)
            own = docs_output / page.path.relative_to(docs_dir)
            for target in {md, own} if own.exists() else {md}:
                target.write_text(text, encoding="utf-8")
        # Endpoint pages generated from OpenAPI specs: published the same way.
        base = self.config.site.route_base_docs.rstrip("/")
        for api_page in self._api.pages if self._api else []:
            md = route_dir / am.page_md_path(f"/{api_page.slug}", "/").lstrip("/")
            src = md.with_name(md.name[: -len(".md")] + am.SOURCE_SUFFIX)
            md.parent.mkdir(parents=True, exist_ok=True)
            src.write_text(api_page.text, encoding="utf-8")
            md.write_text(self._agent_markdown(src, api_page.title, api_page.description), encoding="utf-8")
            self._api_sources[f"{base}/{api_page.slug}"] = src

        # Return list of copied files (simplified)
        return ["docs/"]
