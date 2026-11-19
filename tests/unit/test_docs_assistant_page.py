"""A docs page with ``mode: assistant`` (docs/features/writing-docs.md, the
Ask AI page): the build passes the mode to the browser in docs-nav.json."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config


def _items(items: list) -> list[dict]:
    return [x for i in items for x in (i, *_items(i.get("children", [])))]


def test_assistant_mode_reaches_docs_nav(tmp_path: Path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "index.md").write_text("---\ntitle: Home\n---\n# Home\n", encoding="utf-8")
    (docs / "ask.md").write_text("---\ntitle: Ask\nmode: assistant\n---\n# Ask\n\nAsk anything.\n", encoding="utf-8")
    config = Config.model_validate(yaml.safe_load("site: {title: Acme}\ncontent:\n  docs:\n    dir: docs\n"))
    out = tmp_path / "out"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    nav = json.loads((out / "docs-nav.json").read_text(encoding="utf-8"))
    page = next(i for i in _items(nav["items"]) if i.get("path", "").endswith("/ask"))
    assert page["mode"] == "assistant"
