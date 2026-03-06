"""Main compiler - orchestrates the build process."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from praisonaiui.compiler.docs_scanner import DocsScanner
from praisonaiui.compiler.nav_builder import NavBuilder
from praisonaiui.schema.validators import validate_config

if TYPE_CHECKING:
    from praisonaiui.schema.models import Config


@dataclass
class CompileResult:
    """Result of compilation."""

    success: bool
    files: list[str]
    error: str | None = None


class Compiler:
    """Main compiler that generates manifests from configuration."""

    def __init__(self, config: "Config", base_path: Path | None = None):
        self.config = config
        self.base_path = base_path or Path.cwd()

    def compile(self, output_dir: Path, minify: bool = False) -> CompileResult:
        """
        Compile configuration and docs into manifests.

        Args:
            output_dir: Directory to write manifests
            minify: Whether to minify JSON output

        Returns:
            CompileResult with generated files
        """
        # Validate first
        validation = validate_config(self.config, self.base_path)
        if not validation.valid:
            errors = "; ".join(e.message for e in validation.errors)
            return CompileResult(success=False, files=[], error=f"Validation failed: {errors}")

        # Install component dependencies if specified
        if self.config.dependencies and self.config.dependencies.shadcn:
            from praisonaiui.components import ensure_components
            # Let ensure_components auto-detect the frontend path
            installed, failed = ensure_components(self.config.dependencies.shadcn)
            if failed > 0:
                return CompileResult(
                    success=False,
                    files=[],
                    error=f"Failed to install {failed} component(s)"
                )

        # Ensure output directory exists
        output_dir.mkdir(parents=True, exist_ok=True)
        files: list[str] = []

        indent = None if minify else 2

        # Generate ui-config.json
        ui_config = self._generate_ui_config()
        self._write_json(output_dir / "ui-config.json", ui_config, indent)
        files.append("ui-config.json")

        # Generate docs-nav.json if docs exist
        if self.config.content and self.config.content.docs:
            nav = self._generate_docs_nav()
            self._write_json(output_dir / "docs-nav.json", nav, indent)
            files.append("docs-nav.json")

        # Generate route-manifest.json
        route_manifest = self._generate_route_manifest()
        self._write_json(output_dir / "route-manifest.json", route_manifest, indent)
        files.append("route-manifest.json")

        # Copy viewer.html for serve command
        self._copy_viewer(output_dir)
        files.append("index.html")

        # Copy docs markdown files for content loading
        if self.config.content and self.config.content.docs:
            copied = self._copy_docs(output_dir)
            files.extend(copied)

        # Generate per-route HTML pages (SPA fallback + SEO)
        if self.config.content and self.config.content.docs:
            nav = self._generate_docs_nav()
            route_files = self._generate_route_pages(output_dir, nav)
            files.extend(route_files)

        return CompileResult(success=True, files=files)

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

        # Navigation with tabs
        if self.config.navigation and self.config.navigation.tabs:
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
                                "pages": g.pages,
                            }
                            for g in t.groups
                        ],
                    }
                    for t in self.config.navigation.tabs
                ],
            }

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
                    {"label": lnk.label, "href": lnk.href}
                    for lnk in self.config.navbar.links
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
                        "items": [
                            {"label": item.label, "href": item.href}
                            for item in col.items
                        ],
                    }
                    for col in self.config.footer.links
                ]
            result["footer"] = footer_dict

        # Search
        if self.config.search:
            result["search"] = {
                "enabled": self.config.search.enabled,
                "provider": self.config.search.provider,
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
        if template.zones:
            zones_dict = {}
            zones_data = template.zones.model_dump(by_alias=True, exclude_none=True)
            for zone_name, widgets in zones_data.items():
                if widgets:
                    zones_dict[zone_name] = [
                        {"type": w.get("type"), "props": w.get("props", {})}
                        for w in widgets
                    ]
            if zones_dict:
                result["zones"] = zones_dict

        return result

    def _generate_docs_nav(self) -> dict:
        """Generate docs-nav.json content."""
        if not self.config.content or not self.config.content.docs:
            return {"items": []}

        docs_config = self.config.content.docs
        docs_dir = self.base_path / docs_config.dir

        scanner = DocsScanner(
            docs_dir=docs_dir,
            include=docs_config.include,
            exclude=docs_config.exclude,
            index_files=docs_config.index_files,
        )
        pages = scanner.scan()

        builder = NavBuilder(pages, base_path=self.config.site.route_base_docs)
        return builder.to_dict()

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

    def _write_json(self, path: Path, data: dict, indent: int | None) -> None:
        """Write JSON data to file."""
        path.write_text(json.dumps(data, indent=indent, ensure_ascii=False))

    def _copy_viewer(self, output_dir: Path) -> None:
        """Copy frontend bundle to output directory."""
        import shutil

        # Get the templates directory relative to this file
        templates_dir = Path(__file__).parent.parent / "templates"
        frontend_dir = templates_dir / "frontend"

        if frontend_dir.exists():
            # Copy index.html
            shutil.copy(
                frontend_dir / "index.html",
                output_dir / "index.html",
            )
            # Create 404.html as a copy of index.html for SPA routing
            # on static hosts like GitHub Pages
            shutil.copy(
                frontend_dir / "index.html",
                output_dir / "404.html",
            )
            # Copy assets folder if exists
            assets_src = frontend_dir / "assets"
            if assets_src.exists():
                assets_dst = output_dir / "assets"
                if assets_dst.exists():
                    shutil.rmtree(assets_dst)
                shutil.copytree(assets_src, assets_dst)
            # Copy root-level static files (icons, favicons, etc.)
            static_exts = {
                ".svg", ".png", ".ico", ".webmanifest", ".txt",
            }
            for f in frontend_dir.iterdir():
                if f.is_file() and f.suffix in static_exts:
                    shutil.copy(f, output_dir / f.name)

            # Copy plugins directory and generate plugins.json
            self._copy_plugins(output_dir, frontend_dir)

    def _copy_plugins(
        self, output_dir: Path, frontend_dir: Path
    ) -> None:
        """Copy frontend plugins and generate plugins.json config."""
        import shutil

        plugins_src = frontend_dir / "plugins"
        if not plugins_src.exists():
            return

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

        plugins_config = {"plugins": ordered}
        (plugins_dst / "plugins.json").write_text(
            json.dumps(plugins_config, indent=2)
        )

    def _generate_route_pages(
        self, output_dir: Path, nav: dict
    ) -> list[str]:
        """Generate per-route HTML files for SPA fallback and SEO.

        For each page in the docs navigation, creates an index.html at
        the route path (e.g. _site/docs/concepts/configuration/index.html).
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

        template_html = template_path.read_text()
        site_title = self.config.site.title
        site_desc = self.config.site.description or f"Documentation built with {site_title}"
        files: list[str] = []

        # Collect all pages from nav (including nested children)
        pages = self._collect_nav_pages(nav)

        for page in pages:
            path = page["path"]     # e.g. "/docs/concepts/configuration"
            title = page["title"]   # e.g. "YAML Configuration"

            # Build file system path
            relative = path.lstrip("/")
            page_dir = output_dir / relative
            page_dir.mkdir(parents=True, exist_ok=True)
            page_file = page_dir / "index.html"

            # Build page-specific HTML
            page_title = f"{title} | {site_title}"
            page_desc = f"{title} - {site_desc}"

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
            seo_tags = self._build_seo_tags(path, page_title, page_desc)

            # Try to load markdown content for noscript pre-rendering
            noscript_content = self._get_noscript_content(output_dir, path)

            # Inject SEO tags before </head>
            html = html.replace(
                "</head>",
                f"{seo_tags}\n</head>",
            )

            # Inject noscript block inside <div id="root">
            if noscript_content:
                html = html.replace(
                    '<div id="root"></div>',
                    f'<div id="root"><noscript>{noscript_content}</noscript></div>',
                )

            page_file.write_text(html)
            files.append(f"{relative}/index.html")

        return files

    def _collect_nav_pages(self, nav: dict) -> list[dict]:
        """Recursively collect all pages from docs-nav.json."""
        pages: list[dict] = []
        for item in nav.get("items", []):
            if item.get("path"):
                pages.append({"path": item["path"], "title": item.get("title", "")})
            for child in item.get("children", []):
                if child.get("path"):
                    pages.append({"path": child["path"], "title": child.get("title", "")})
                # Handle deeper nesting if present
                for grandchild in child.get("children", []):
                    if grandchild.get("path"):
                        pages.append({"path": grandchild["path"], "title": grandchild.get("title", "")})
        return pages

    def _build_seo_tags(self, path: str, title: str, description: str) -> str:
        """Build canonical, OG, and Twitter meta tags."""
        t = self._escape_html(title)
        d = self._escape_html(description)
        p = self._escape_html(path)
        return (
            f'  <link rel="canonical" href="{p}" />\n'
            f'  <meta property="og:title" content="{t}" />\n'
            f'  <meta property="og:description" content="{d}" />\n'
            f'  <meta property="og:url" content="{p}" />\n'
            f'  <meta name="twitter:card" content="summary" />\n'
            f'  <meta name="twitter:title" content="{t}" />\n'
            f'  <meta name="twitter:description" content="{d}" />'
        )

    def _get_noscript_content(self, output_dir: Path, path: str) -> str:
        """Load markdown file and convert to simple HTML for noscript block."""
        # Try to find the corresponding markdown file
        relative = path.lstrip("/")
        md_candidates = [
            output_dir / relative / "index.md",
            output_dir / f"{relative}.md",
        ]

        md_content = None
        for candidate in md_candidates:
            if candidate.exists():
                md_content = candidate.read_text()
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

        for line in lines:
            stripped = line.strip()

            # Skip frontmatter
            if stripped == "---" and not result:
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
                result.append(f"<li>{text}</li>")
                continue

            # Paragraphs
            result.append(f"<p>{stripped}</p>")

        return "\n".join(result)

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

        # Copy the entire docs directory
        shutil.copytree(docs_dir, docs_output)

        # Return list of copied files (simplified)
        return ["docs/"]

