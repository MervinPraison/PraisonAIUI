"""Content languages (``navigation.languages``): folders, ui-config.json, hreflang links,
``<html lang>``, sitemap alternates, llms files, languages inside versions, and the 7020 checks."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config
from praisonaiui.schema.validators import find_unknown_keys

DOCS = {
    "index.md": "# Home\n\nWelcome.\n",
    "guide/setup.md": "# Setup\n\nInstall it.\n",
    "only-en.md": "# Only English\n\nNot translated.\n",
    "fr/index.md": "# Accueil\n\nBienvenue.\n",
    "fr/guide/setup.md": "# Installation\n\nInstallez-le.\n",
}

YAML = """
site: {title: T}
seo: {siteUrl: "https://docs.example.com"}
content:
  docs: {dir: docs}
navigation:
  languages:
    - {language: en, default: true}
    - {language: fr, label: Français}
templates: {docs: {layout: Default, slots: {}}}
routes: [{match: "/docs/**", template: docs}]
"""


def _build(tmp_path: Path, text: str = YAML, docs: dict | None = None) -> tuple[dict, dict, Path]:
    for rel, body in (docs or DOCS).items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body)
    out = tmp_path / "site"
    assert Compiler(Config.model_validate(yaml.safe_load(text)), base_path=tmp_path).compile(output_dir=out).success
    return json.loads((out / "ui-config.json").read_text()), json.loads((out / "docs-nav.json").read_text()), out


def _pages(items: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for item in items:
        if item.get("path"):
            out[item["path"]] = item
        out.update(_pages(item.get("children") or []))
    return out


def test_ui_config_lists_languages_with_folder_default_and_name(tmp_path: Path) -> None:
    ui, _, _ = _build(tmp_path)
    assert ui["navigation"]["languages"] == [
        {"language": "en", "folder": "", "prefix": "/docs", "default": True},
        {"language": "fr", "name": "Français", "folder": "fr", "prefix": "/docs/fr"},
    ]
    assert "languageRedirect" not in ui["navigation"]
    assert find_unknown_keys(Config, yaml.safe_load(YAML)) == []
    ui, _, _ = _build(tmp_path, YAML.replace("  languages:", "  languageRedirect: false\n  languages:"))
    assert ui["navigation"]["languageRedirect"] is False


def test_a_language_folder_is_its_own_top_level_sidebar(tmp_path: Path) -> None:
    _, nav, _ = _build(tmp_path)
    top = [i.get("path") or i["title"] for i in nav["items"]]
    assert "/docs/fr" in top and "Fr" not in top


def test_each_page_names_its_translations_and_its_language(tmp_path: Path) -> None:
    _, _, out = _build(tmp_path)
    fr = (out / "docs/fr/guide/setup.html").read_text()
    assert '<html lang="fr">' in fr
    for code, url in (("en", "/docs/guide/setup"), ("fr", "/docs/fr/guide/setup"), ("x-default", "/docs/guide/setup")):
        assert f'<link rel="alternate" hreflang="{code}" href="https://docs.example.com{url}" />' in fr
    en = (out / "docs/guide/setup.html").read_text()
    assert '<html lang="en">' in en and 'hreflang="fr"' in en
    # A page with no translation names none; the home page is the site root.
    assert "hreflang" not in (out / "docs/only-en.html").read_text()
    home = (out / "docs/fr.html").read_text()
    assert 'hreflang="en" href="https://docs.example.com/"' in home


def test_sitemap_lists_every_language_with_its_alternates(tmp_path: Path) -> None:
    _, _, out = _build(tmp_path)
    xml = (out / "sitemap.xml").read_text()
    assert 'xmlns:xhtml="http://www.w3.org/1999/xhtml"' in xml
    assert "<loc>https://docs.example.com/docs/fr/guide/setup</loc>" in xml
    assert '<xhtml:link rel="alternate" hreflang="fr" href="https://docs.example.com/docs/fr/guide/setup"/>' in xml
    root = next(line for line in xml.splitlines() if "<loc>https://docs.example.com/</loc>" in line)
    assert 'hreflang="fr" href="https://docs.example.com/docs/fr"' in root


def test_llms_txt_holds_the_default_language_and_each_other_has_its_own(tmp_path: Path) -> None:
    _, _, out = _build(tmp_path)
    paths = {p["p"] for p in json.loads((out / "search-index.json").read_text())["pages"]}
    assert {"/docs/guide/setup", "/docs/fr/guide/setup"} <= paths  # search filters by language in the browser
    llms = (out / "llms.txt").read_text()
    assert "Setup" in llms and "Installation" not in llms
    assert "https://docs.example.com/llms-fr.txt" in llms
    assert "Installation" not in (out / "llms-full.txt").read_text()
    fr = (out / "llms-fr.txt").read_text()
    assert "## Docs (Français)" in fr and "Installation" in fr and "Setup" not in fr
    # `index: true` puts a language into llms.txt as well.
    text = YAML.replace("label: Français}", "label: Français, index: true}")
    _, _, out = _build(tmp_path, text)
    assert "Installation" in (out / "llms.txt").read_text()


def test_a_language_inside_a_version(tmp_path: Path) -> None:
    text = YAML.replace("  languages:", "  versions:\n    - {version: v2, default: true}\n    - {version: v1}\n  languages:")
    docs = {**DOCS, "v1/index.md": "# Home v1\n", "v1/fr/index.md": "# Accueil v1\n",
            "v1/fr/guide/setup.md": "# Installation v1\n", "v1/guide/setup.md": "# Setup v1\n"}
    _, nav, out = _build(tmp_path, text, docs)
    top = [i.get("path") or i["title"] for i in nav["items"]]
    assert "/docs/v1/fr" in top
    page = _pages(nav["items"])["/docs/v1/fr/guide/setup"]
    # An older version's page points at the current docs and names no translations.
    assert page["seo"]["canonical"] == "/docs/fr/guide/setup" and "hreflang:en" not in page["seo"]
    assert '<html lang="fr">' in (out / "docs/v1/fr/guide/setup.html").read_text()


def test_validate_reports_7020(tmp_path: Path) -> None:
    text = YAML.replace("- {language: fr, label: Français}", "- {language: fr, default: true}\n    - {language: fr}")
    text = text.replace("  languages:", "  versions:\n    - {version: v2, default: true}\n    - {version: v1}\n  languages:")
    for rel, body in {**DOCS, "fr/v1/index.md": "# x\n"}.items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body)
    found = Compiler(Config.model_validate(yaml.safe_load(text)), base_path=tmp_path).lint_content()
    messages = [i.message for i in found if i.code == 7020]
    assert "2 languages use the code 'fr'" in messages
    assert "more than one language is marked default: true" in messages
    assert "version folder 'v1' is inside language folder 'fr'" in messages
