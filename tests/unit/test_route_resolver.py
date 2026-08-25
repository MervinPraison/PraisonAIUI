"""Unit tests for route template resolver (mirrors src/frontend/src/resolver.ts)."""

from __future__ import annotations

import re


def match_pattern(path: str, pattern: str) -> bool:
    normalized_path = path.strip("/")
    normalized_pattern = pattern.strip("/")
    regex_pattern = (
        normalized_pattern.replace("**", "{{GLOB}}")
        .replace("*", "[^/]+")
        .replace("{{GLOB}}", ".*")
    )
    return re.match(f"^{regex_pattern}$", normalized_path) is not None


def resolve_template(path: str, manifest: dict, templates: dict) -> dict | None:
    routes = sorted(manifest.get("routes", []), key=lambda r: r.get("priority", 0), reverse=True)
    for route in routes:
        if not match_pattern(path, route["pattern"]):
            continue
        template_name = route["template"]
        template = templates.get(template_name)
        if not template:
            return None
        return {
            "template": template_name,
            "layout": template.get("layout", "ThreeColumnLayout"),
            "slots": template.get("slots", {}),
            "slotOverrides": route.get("slotOverrides"),
        }
    return None


def merged_slot(slot_name: str, match: dict | None):
    if not match:
        return None
    overrides = match.get("slotOverrides") or {}
    if slot_name in overrides:
        return overrides[slot_name]
    return match.get("slots", {}).get(slot_name)


def should_show_toc(match: dict | None) -> bool:
    return merged_slot("right", match) is not None


class TestRouteResolver:
    def test_match_docs_glob(self):
        assert match_pattern("docs/index", "/docs/**")
        assert match_pattern("docs/getting-started/installation", "/docs/**")
        assert not match_pattern("blog/post", "/docs/**")

    def test_specific_route_wins_by_priority(self):
        manifest = {
            "routes": [
                {"pattern": "/docs/changelog", "template": "changelog", "priority": 2},
                {"pattern": "/docs/**", "template": "docs", "priority": 1},
            ]
        }
        templates = {
            "docs": {"layout": "ThreeColumnLayout"},
            "changelog": {"layout": "TwoColumnLayout", "slots": {"right": None}},
        }
        match = resolve_template("docs/changelog", manifest, templates)
        assert match is not None
        assert match["template"] == "changelog"
        assert match["layout"] == "TwoColumnLayout"

    def test_changelog_hides_toc_when_right_null(self):
        manifest = {
            "routes": [
                {"pattern": "/docs/changelog", "template": "changelog", "priority": 2},
            ]
        }
        templates = {"changelog": {"layout": "TwoColumnLayout", "slots": {"right": None}}}
        match = resolve_template("docs/changelog", manifest, templates)
        assert should_show_toc(match) is False

    def test_docs_shows_toc_by_default(self):
        manifest = {"routes": [{"pattern": "/docs/**", "template": "docs", "priority": 1}]}
        templates = {"docs": {"layout": "ThreeColumnLayout", "slots": {"right": {"ref": "toc"}}}}
        match = resolve_template("docs/index", manifest, templates)
        assert should_show_toc(match) is True
