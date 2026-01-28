"""Main compiler - orchestrates the build process."""

from __future__ import annotations

import json
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

        return CompileResult(success=True, files=files)

    def _generate_ui_config(self) -> dict:
        """Generate ui-config.json content."""
        return {
            "site": {
                "title": self.config.site.title,
                "description": self.config.site.description,
                "routeBaseDocs": self.config.site.route_base_docs,
                "ui": self.config.site.ui,
                "theme": (
                    {
                        "radius": self.config.site.theme.radius,
                        "brandColor": self.config.site.theme.brand_color,
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
                name: {
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
                for name, template in self.config.templates.items()
            },
        }

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
