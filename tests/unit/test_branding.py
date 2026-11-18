"""Branding of a docs build: logo and favicon per mode, brand colours, theme lock, background."""

from __future__ import annotations

import json
from pathlib import Path

from praisonaiui.compiler import Compiler
from praisonaiui.compiler.content_lint import accent_contrast
from praisonaiui.schema.models import Config
from praisonaiui.themes import get_pro_seed_css, get_seed_theme_css


def _build(tmp_path: Path, **extra) -> Path:
    docs = tmp_path / "docs"
    docs.mkdir(exist_ok=True)
    (docs / "index.md").write_text("# Home\n", encoding="utf-8")
    (docs / "guide.md").write_text("# Guide\n", encoding="utf-8")
    for name in ("logo.svg", "logo-dark.svg", "favicon.svg", "favicon-dark.png", "bg.png"):
        (tmp_path / name).write_text("<svg/>", encoding="utf-8")
    data = {"site": {"title": "Acme", **extra.pop("site", {})}, "content": {"docs": {"dir": "docs"}}, **extra}
    out = tmp_path / "out"
    result = Compiler(Config.model_validate(data), base_path=tmp_path).compile(out)
    assert result.success, result.error
    return out


def _html(out: Path) -> list[str]:
    return [(out / p).read_text(encoding="utf-8") for p in ("index.html", "404.html", "docs/guide/index.html")]


def test_favicon_one_file_is_published_and_linked_on_every_page(tmp_path):
    out = _build(tmp_path, favicon="favicon.svg")
    assert (out / "favicon.svg").read_text() == "<svg/>"
    for page in _html(out):
        assert '<link rel="icon" href="/favicon.svg" />' in page
        assert 'href="/icon.svg"' not in page


def test_favicon_light_and_dark_follow_the_browser_scheme(tmp_path):
    out = _build(tmp_path, favicon={"light": "favicon.svg", "dark": "favicon-dark.png"}, site={"basePath": "/acme"})
    for page in _html(out):
        assert '<link rel="icon" href="/acme/favicon.svg" media="(prefers-color-scheme: light)" />' in page
        assert '<link rel="icon" href="/acme/favicon-dark.png" media="(prefers-color-scheme: dark)" />' in page
    assert (out / "favicon-dark.png").is_file()


def test_logo_files_beside_the_config_are_published(tmp_path):
    out = _build(tmp_path, logo={"light": "logo.svg", "dark": "logo-dark.svg", "href": "https://acme.dev"})
    logo = json.loads((out / "ui-config.json").read_text())["logo"]
    assert logo == {"light": "/logo.svg", "dark": "/logo-dark.svg", "href": "https://acme.dev"}
    assert (out / "logo.svg").is_file() and (out / "logo-dark.svg").is_file()


def test_logo_string_and_site_logo_image_are_the_logo(tmp_path):
    out = _build(tmp_path, logo="logo.svg")
    assert json.loads((out / "ui-config.json").read_text())["logo"]["light"] == "/logo.svg"
    out = _build(tmp_path, site={"logo": "/brand.svg"})
    assert json.loads((out / "ui-config.json").read_text())["logo"]["light"] == "/brand.svg"


def test_an_emoji_logo_or_a_path_outside_the_project_is_left_alone(tmp_path):
    out = _build(tmp_path, site={"logo": "A"}, favicon="../../etc/passwd.svg")
    assert "logo" not in json.loads((out / "ui-config.json").read_text())
    assert not (out / "etc").exists()


def test_accent_and_accent_dark_reach_the_docs_theme(tmp_path):
    out = _build(tmp_path, site={"theme": {"accent": "#0f766e", "accentDark": "#f59e0b"}})
    css = (out / "assets" / "theme.css").read_text()
    assert "--seed-accent-light: #0f766e;" in css and "--seed-accent-dark: #f59e0b;" in css
    assert "--seed-pro-accent-light: #0f766e;" in css  # the teal swatch
    assert "--seed-pro-accent-dark: #f59e0b;" in css


def test_accent_dark_only_changes_the_dark_roles():
    one = get_pro_seed_css("zinc", "#7c3aed")
    two = get_pro_seed_css("zinc", "#7c3aed", "#c4b5fd")
    light = [line for line in one.splitlines() if "-light:" in line]
    assert light == [line for line in two.splitlines() if "-light:" in line]
    assert "--seed-pro-accent-dark: #c4b5fd;" in two
    assert "--seed-accent:" in get_seed_theme_css("zinc", accent="#7c3aed", accent_dark="not a colour")


def test_accent_dark_is_the_one_checked_on_the_dark_background():
    assert accent_contrast("#2563eb", "#1e3a8a")[0].file == "site.theme.accentDark"
    assert accent_contrast("#1e3a8a", "#93c5fd") == []


def test_strict_locks_the_mode(tmp_path):
    out = _build(tmp_path, site={"theme": {"mode": "dark", "strict": True}})
    assert json.loads((out / "ui-config.json").read_text())["site"]["theme"]["strict"] is True
    page = (out / "index.html").read_text()
    assert "localStorage.getItem('aiui-theme-preference')" not in page
    assert "var t=null;var d=true;" in page


def test_background_decoration_and_image(tmp_path):
    out = _build(tmp_path, site={"theme": {"background": "grid"}})
    assert '<html data-aiui-bg="grid"' in (out / "index.html").read_text()
    out = _build(tmp_path, site={"theme": {"background": "bg.png"}, "basePath": "/acme"})
    assert '<html data-aiui-bg="image"' in (out / "docs/guide/index.html").read_text()
    assert ':root { --aiui-bg-image: url("/acme/bg.png"); }' in (out / "assets" / "theme.css").read_text()
    assert (out / "bg.png").is_file()


def test_no_branding_keeps_the_bundle_icon(tmp_path):
    out = _build(tmp_path)
    page = (out / "index.html").read_text()
    assert 'href="/icon.svg"' in page and "data-aiui-bg" not in page
    assert "localStorage.getItem('aiui-theme-preference')" in page


def test_validate_flags_a_brand_image_the_build_cannot_publish(tmp_path):
    (tmp_path / "logo.svg").write_text("<svg/>", encoding="utf-8")
    data = {
        "site": {"title": "Acme", "theme": {"background": "missing.png"}},
        "logo": {"light": "logo.svg", "dark": "logo-dark.svg"},
        "favicon": "../outside.svg",
    }
    issues = Compiler(Config.model_validate(data), base_path=tmp_path).lint_content()
    assert sorted((i.code, i.file) for i in issues) == [
        (7102, "favicon.light"), (7102, "logo.dark"), (7102, "site.theme.background")]
