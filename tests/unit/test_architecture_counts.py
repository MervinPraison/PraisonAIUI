"""ARCHITECTURE.md quotes counts reviewers check PRs against (R5 additive-only,
the layer map). Keep them equal to the code, so they cannot drift again."""

from __future__ import annotations

import re
from pathlib import Path

from praisonaiui.builtin.catalog import BUILTIN_PLUGINS

ROOT = Path(__file__).resolve().parents[2]
ARCH = (ROOT / "ARCHITECTURE.md").read_text(encoding="utf-8")
MANIFEST_TS = ROOT / "src" / "frontend" / "src" / "sdk" / "manifest.ts"
LAYOUT_DESCRIPTORS = ROOT / "src" / "frontend" / "src" / "builtin" / "layouts"
_WORDS = {"five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}


def _quoted(pattern: str) -> int:
    m = re.search(pattern, ARCH)
    assert m, f"ARCHITECTURE.md no longer says {pattern!r}"
    value = m.group(1)
    return _WORDS[value] if value in _WORDS else int(value)


def test_sdk_exports_count():
    src = MANIFEST_TS.read_text(encoding="utf-8")
    exports = re.search(r"export const SDK_EXPORTS = \[(.*?)\]", src, re.S)
    assert exports
    names = re.findall(r"'([^']+)'", exports.group(1))
    assert _quoted(r"sdk/manifest\.ts`, (\d+) names today") == len(names)


def test_catalog_counts():
    pages = sum(len(list(p.pages())) for p in BUILTIN_PLUGINS)
    shell = sum(len(list(p.shell_pages() or ())) for p in BUILTIN_PLUGINS)
    features = sum(len(p.feature_refs) for p in BUILTIN_PLUGINS)
    assert _quoted(r"\((\d+) `BuiltinPlugin` records") == len(BUILTIN_PLUGINS)
    assert _quoted(r"records, (\d+) pages") == pages
    assert _quoted(r"pages plus (\d+) shell-only pages") == shell
    assert _quoted(r"(\d+) feature refs\)") == features


def test_layout_descriptor_count():
    skip = {"index.ts", "types.ts"}
    files = [f for f in LAYOUT_DESCRIPTORS.glob("*.ts") if f.name not in skip and ".test." not in f.name]
    assert _quoted(r"`builtin\.layouts` with the (\w+) layout descriptors") == len(files)
