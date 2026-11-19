"""MkDocs importer: tags, nav, losses, handler replacement, and isolation."""

from __future__ import annotations

import subprocess
import sys

import yaml
from typer.testing import CliRunner

from praisonaiui.mkdocs_import import (
    HandlerRegistry,
    builtin_handlers,
    convert_mkdocs,
    get_registry,
)
from praisonaiui.mkdocs_import.cli import app
from praisonaiui.mkdocs_import.model import AiuiDraft, Finding, MkDocsDocument
from praisonaiui.schema.models import Config

SAMPLE = """
site_name: PraisonAIWP
site_description: AI-powered WordPress content management
site_url: https://wpcli.praison.ai/
repo_url: https://github.com/MervinPraison/PraisonAI-WPcli
copyright: Copyright &copy; 2024 Mervin Praison
docs_dir: mkdocs-docs
theme:
  name: !ENV [PRAISONAI_THEME, material]
  palette:
    - scheme: default
      primary: deep purple
plugins:
  - search
  - mkdocstrings:
      handlers:
        python:
          options:
            show_source: true
markdown_extensions:
  - admonition
  - pymdownx.snippets
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
hooks:
  - docs/hooks.py
exclude_docs: |
  lazy-loading.md
  snippets/
nav:
  - Home: index.md
  - Getting Started:
      - Overview: getting-started/index.md
      - Installation: getting-started/installation.md
  - Video:
      - Export: video-export.md
      - Pipelines:
          - Overview: pipeline-overview.md
extra:
  social:
    - icon: fontawesome/brands/github
      link: https://github.com/MervinPraison
    - icon: fontawesome/brands/x-twitter
      link: https://x.com/MervinPraison
  version:
    provider: mike
"""


def _codes(result, level):
    return [item.code for item in result.findings if item.level == level]


def test_package_and_cli_import_do_not_load_the_importer():
    code = (
        "import sys, praisonaiui, praisonaiui.cli; "
        "raise SystemExit(0 if 'praisonaiui.mkdocs_import' not in sys.modules else 1)"
    )
    proc = subprocess.run([sys.executable, "-c", code], check=False)
    assert proc.returncode == 0


def test_env_and_python_tags_convert_to_a_valid_config(tmp_path):
    source = tmp_path / "mkdocs.yml"
    source.write_text(SAMPLE, encoding="utf-8")

    result = convert_mkdocs(source)

    assert result.ok, result.error
    Config.model_validate(result.data)
    assert result.draft.site_title == "PraisonAIWP"
    assert result.draft.docs_dir == "mkdocs-docs"
    assert result.draft.preset == "paper"
    assert result.draft.mode == "system"
    assert result.draft.site_url == "https://wpcli.praison.ai"
    assert result.draft.copyright == "Copyright © 2024 Mervin Praison"
    assert result.draft.socials["x"] == "https://x.com/MervinPraison"
    assert result.draft.exclude == ["lazy-loading.md", "snippets/**"]
    assert result.page_count == 5
    assert [tab.tab for tab in result.draft.tabs] == ["Home", "Getting Started", "Video"]
    started = result.draft.tabs[1].groups[0]
    assert started.prefix == "getting-started"
    assert started.pages == ["getting-started/index", "getting-started/installation"]
    assert result.draft.tabs[2].groups[1].pages == ["pipeline-overview"]
    assert "plugin:mkdocstrings" in _codes(result, "dropped")
    assert "hooks" in _codes(result, "dropped")
    assert "snippets" in _codes(result, "dropped")
    assert "python_tag" in _codes(result, "dropped")
    loaded = yaml.safe_load(result.yaml_text)
    assert loaded["site"]["theme"]["preset"] == "paper"
    assert loaded["site"]["theme"]["mode"] == "system"
    assert "mkdocstrings" in result.yaml_text


def test_missing_nav_leaves_navigation_unset(tmp_path):
    source = tmp_path / "mkdocs.yml"
    source.write_text("site_name: Plain\n", encoding="utf-8")

    result = convert_mkdocs(source)

    assert result.ok
    assert "navigation" not in result.data
    assert result.draft.docs_dir == "docs"
    assert result.draft.search_enabled is True


def test_explicit_plugins_without_search_disable_search(tmp_path):
    source = tmp_path / "mkdocs.yml"
    source.write_text("site_name: Quiet\nplugins:\n  - mkdocstrings\n", encoding="utf-8")

    result = convert_mkdocs(source)

    assert result.draft.search_enabled is False
    assert result.data["search"]["enabled"] is False


def test_handler_replacement_is_local_to_the_registry(tmp_path):
    class ForceTheme:
        name = "theme"

        def apply(self, doc: MkDocsDocument, draft: AiuiDraft, findings: list[Finding]) -> None:
            del doc, findings
            draft.preset = "teal"

    registry = HandlerRegistry()
    for handler in builtin_handlers():
        registry.register(handler)
    registry.register(ForceTheme())

    source = tmp_path / "mkdocs.yml"
    source.write_text(SAMPLE, encoding="utf-8")
    result = convert_mkdocs(source, registry=registry)

    assert result.draft.preset == "teal"
    default_theme = [
        handler for handler in get_registry().handlers() if handler.name == "theme"
    ]
    assert [type(handler).__name__ for handler in default_theme] == ["ThemeHandler"]


def test_many_loose_pages_stay_in_one_tab(tmp_path):
    pages = "\n".join(f"  - Page {i}: page-{i}.md" for i in range(9))
    source = tmp_path / "mkdocs.yml"
    source.write_text(f"site_name: Flat\nnav:\n{pages}\n", encoding="utf-8")

    result = convert_mkdocs(source)

    assert [tab.tab for tab in result.draft.tabs] == ["Documentation"]
    assert result.page_count == 9


def test_cli_refuses_to_overwrite_without_force(tmp_path):
    source = tmp_path / "mkdocs.yml"
    source.write_text("site_name: Demo\nnav:\n  - Home: index.md\n", encoding="utf-8")
    runner = CliRunner()

    first = runner.invoke(app, [str(source)])
    assert first.exit_code == 0, first.output
    destination = tmp_path / "aiui.template.yaml"
    assert destination.exists()
    original = source.read_text(encoding="utf-8")

    second = runner.invoke(app, [str(source)])
    assert second.exit_code == 2
    assert source.read_text(encoding="utf-8") == original

    dry = runner.invoke(app, [str(source), "--dry-run"])
    assert dry.exit_code == 0
    assert "schemaVersion" in dry.output
    assert destination.read_text(encoding="utf-8")  # dry-run does not need to match; file still present


def test_unreadable_yaml_is_an_error(tmp_path):
    source = tmp_path / "mkdocs.yml"
    source.write_text("nav: [\n", encoding="utf-8")

    result = CliRunner().invoke(app, [str(source), "--dry-run"])

    assert result.exit_code == 1
    assert not (tmp_path / "aiui.template.yaml").exists()
