"""Changelog pages: <Update> entries, the RSS feed of a page with ``rss: true``, its head link."""

import json
import xml.etree.ElementTree as ET
from pathlib import Path

from praisonaiui.compiler import Compiler, changelog
from praisonaiui.compiler.agent_markdown import to_agent_markdown
from praisonaiui.compiler.content_lint import FRONTMATTER_TYPES
from praisonaiui.compiler.docs_tags import KNOWN_DOCS_TAGS
from praisonaiui.compiler.search_index import page_entry
from praisonaiui.schema.models import Config

CHANGELOG = """---
title: Changelog
description: What changed.
rss: true
---
# Changelog

<Update label="2026-11-18" description="v1.2" tags={["API", "Fix"]}>
Faster builds. See [the guide](guide.md) and <b>x</b> & "y".

- One
- Two

```bash
aiui build <out>
```
</Update>

<Update label="Release <3" id="older" tags="Docs">
Older entry.
</Update>
"""


def _build(tmp_path: Path, **site) -> Path:
    docs = tmp_path / "docs"
    docs.mkdir(parents=True, exist_ok=True)
    (docs / "changelog.md").write_text(CHANGELOG, encoding="utf-8")
    (docs / "guide.md").write_text("# Guide\n\nA guide page with <Update> in text only.\n", encoding="utf-8")
    config = Config.model_validate({
        "site": {"title": "Acme Docs", **site},
        "seo": {"siteUrl": "https://acme.test"},
        "content": {"docs": {"dir": "docs"}},
        "templates": {"docs": {"layout": "ThreeColumnLayout", "slots": {}}},
        "routes": [{"match": "/docs/**", "template": "docs"}],
    })
    out = tmp_path / "site"
    result = Compiler(config, base_path=tmp_path).compile(output_dir=out)
    assert result.success, result.error
    return out


def test_rss_page_gets_a_valid_feed_with_absolute_links(tmp_path: Path) -> None:
    out = _build(tmp_path, basePath="/repo")
    channel = ET.parse(out / "docs/changelog/rss.xml").getroot().find("channel")
    assert channel.findtext("title") == "Changelog | Acme Docs"
    assert channel.findtext("link") == "https://acme.test/repo/docs/changelog"
    self_link = channel.find("{http://www.w3.org/2005/Atom}link")
    assert self_link.get("href") == "https://acme.test/repo/docs/changelog/rss.xml"
    first, second = channel.findall("item")
    assert first.findtext("title") == "2026-11-18: v1.2"
    assert first.findtext("link") == "https://acme.test/repo/docs/changelog#2026-11-18"
    assert first.findtext("pubDate") == "Wed, 18 Nov 2026 00:00:00 +0000"
    assert [c.text for c in first.findall("category")] == ["API", "Fix"]
    body = first.findtext("description")
    assert '<a href="https://acme.test/repo/docs/guide">the guide</a>' in body
    assert "&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;" in body  # escaped, never markup (R9)
    assert "<ul><li>One</li><li>Two</li></ul>" in body
    assert "<pre><code>aiui build &lt;out&gt;</code></pre>" in body
    assert second.findtext("title") == "Release <3"
    assert second.findtext("link").endswith("#older") and second.find("pubDate") is None
    assert channel.findtext("lastBuildDate") == first.findtext("pubDate")


def test_feed_is_linked_from_that_page_head_only(tmp_path: Path) -> None:
    out = _build(tmp_path)
    html = (out / "docs/changelog.html").read_text()
    assert (
        '<link rel="alternate" type="application/rss+xml" title="Changelog | Acme Docs"'
        ' href="https://acme.test/docs/changelog/rss.xml" />'
    ) in html
    assert "application/rss+xml" not in (out / "docs/guide.html").read_text()
    assert not (out / "docs/guide/rss.xml").exists()


def test_entries_are_sections_in_search_and_llms(tmp_path: Path) -> None:
    out = _build(tmp_path)
    page = next(p for p in json.loads((out / "search-index.json").read_text())["pages"] if p["p"] == "/docs/changelog")
    found = {s["h"]: s for s in page["s"]}
    assert found["2026-11-18"]["a"] == "2026-11-18" and "v1.2" in found["2026-11-18"]["x"]
    assert found["Release <3"]["a"] == "older"
    md = (out / "docs/changelog.md").read_text()
    assert "## 2026-11-18\n\nv1.2 · API, Fix\n\nFaster builds." in md
    assert "<Update" not in md


def test_agent_markdown_and_tag_tables_know_update() -> None:
    md = to_agent_markdown('<Update label="May 2026" tags="UI" />\n\nAfter.', title="Log")
    assert "## May 2026\n\nUI\n\nAfter." in md
    assert "Update" in KNOWN_DOCS_TAGS and FRONTMATTER_TYPES["rss"] == "true or false"
    assert changelog.entry_date("November 18, 2026").day == 18
    assert changelog.entry_date("v1.2 (2026-11-18)").month == 11
    assert changelog.entry_date("Next") is None
    entry = page_entry("/docs/x", "X", "", '<Update label="Q1 launch" description="Big">\nText\n</Update>\n', {})
    assert entry["s"][0]["a"] == "q1-launch"
