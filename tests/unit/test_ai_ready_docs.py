"""AI-ready docs (docs/features/ai-ready-docs.md): the agent-ready ``<route>.md``,
llms.txt by nav group, llms-full.txt, markdown.instructions,
.mdx pages, <Visibility>, the alternate link and ``Accept: text/markdown`` on
``aiui serve``."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from praisonaiui.compiler.agent_markdown import prefers_markdown, to_agent_markdown
from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config

INSTALL = """---
title: Install
description: Get aiui running.
---

# Install

Read [setup](setup.md#first) or [home](/docs) first, `<Note>` stays.

<Note>Python 3.10 or newer.</Note>

<Tabs>
<Tab title="pip">
```bash
pip install aiui
```
</Tab>
<Tab title="uv">Run uv add.</Tab>
</Tabs>

<Steps>
  <Step title="Install">
    Run it.
  </Step>
  <Step title="Serve">Open the site.</Step>
</Steps>

<CardGroup cols={2}>
<Card title="Guide" href="/docs/guide/setup">The guide.</Card>
</CardGroup>

<Visibility for="humans">Click the blue button.</Visibility>
<Visibility for="agents">Call the API instead.</Visibility>

<Warning title="Careful">
  Back up first.
</Warning>

```mdx
<Note>literal</Note>
```
"""

DOCS = {
    "index.md": "---\ntitle: Home\n---\n# Home\n\nWelcome.\n",
    "guide/install.md": INSTALL,
    "guide/setup.md": "# Setup\n\nSet it up.\n",
    "api/misc.mdx": "---\ntitle: Misc\n---\n\n## Searchable section\n\nMDX body text.\n",
}


def _build(tmp_path: Path, site_url: str | None = "https://ex.com") -> Path:
    for rel, text in DOCS.items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    seo = f"seo: {{siteUrl: '{site_url}'}}" if site_url else ""
    config = Config.model_validate(
        yaml.safe_load(
            f"""
site: {{title: Acme Docs, description: Acme product docs.}}
{seo}
markdown:
  instructions: [Cite the page URL., Prefer the CLI.]
content:
  docs: {{dir: docs, nav: {{mode: manual}}}}
navigation:
  tabs:
    - tab: Guides
      groups:
        - group: Get started
          pages: [index, guide/install, guide/setup]
    - tab: API reference
      groups:
        - group: Reference
          pages: [api/misc]
"""
        )
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def test_the_published_md_is_agent_ready(tmp_path: Path) -> None:
    out = _build(tmp_path)
    md = (out / "docs/guide/install.md").read_text(encoding="utf-8")
    assert md.startswith("# Install\n\n> Get aiui running.\n\n> ## Agent instructions\n>\n> - Cite the page URL.\n")
    assert "title: Install" not in md and md.count("# Install") == 1
    assert "[setup](https://ex.com/docs/guide/setup.md#first)" in md
    assert "[home](https://ex.com/docs/index.md)" in md
    assert "`<Note>` stays" in md
    assert "> **Note:** Python 3.10 or newer." in md
    assert "## pip\n\n```bash\npip install aiui\n```" in md and "## uv\n\nRun uv add." in md
    assert "1. **Install**\n\n   Run it.\n\n2. **Serve**\n\n   Open the site." in md
    assert "- [Guide](https://ex.com/docs/guide/setup.md)\n  The guide." in md
    assert "Call the API instead." in md and "blue button" not in md
    assert "> **Warning: Careful**\n>\n> Back up first." in md
    assert "```mdx\n<Note>literal</Note>\n```" in md
    for tag in ("<Tabs>", "<Step ", "<Card ", "<Visibility", "<Warning"):
        assert tag not in md
    # The browser renders the untouched source, published beside it.
    assert (out / "docs/guide/install.source.md").read_text(encoding="utf-8") == INSTALL
    assert (out / "docs/api/misc.md").read_text(encoding="utf-8").startswith("# Misc\n")


def test_each_page_names_its_markdown_and_llms_txt_lists_it_by_group(tmp_path: Path) -> None:
    out = _build(tmp_path)
    link = '<link rel="alternate" type="text/markdown" href="https://ex.com/docs/{}.md" />'
    assert link.format("guide/install") in (out / "docs/guide/install.html").read_text(encoding="utf-8")
    assert link.format("index") in (out / "index.html").read_text(encoding="utf-8")
    llms = (out / "llms.txt").read_text(encoding="utf-8")
    assert llms.startswith("# Acme Docs\n\n> Acme product docs.\n\n> ## Agent instructions\n")
    assert "## Get started\n\n- [Home](https://ex.com/docs/index.md)\n" in llms
    assert "- [Install](https://ex.com/docs/guide/install.md): Get aiui running." in llms
    assert "## Reference\n\n- [Misc](https://ex.com/docs/api/misc.md)" in llms
    assert "(https://ex.com/llms-full.txt)" in llms
    assert (out / ".well-known/llms.txt").read_text(encoding="utf-8") == llms
    full = (out / "llms-full.txt").read_text(encoding="utf-8")
    assert full.count("## Agent instructions") == 1
    assert "# Install\n\nSource: https://ex.com/docs/guide/install\n\n> Get aiui running." in full
    assert "> **Note:** Python 3.10 or newer." in full and "MDX body text." in full
    assert "blue button" not in full


def test_search_indexes_mdx_pages_and_the_human_view(tmp_path: Path) -> None:
    out = _build(tmp_path)
    pages = {p["p"]: json.dumps(p) for p in json.loads((out / "search-index.json").read_text())["pages"]}
    assert "Searchable section" in pages["/docs/api/misc"] and "MDX body text" in pages["/docs/api/misc"]
    assert "blue button" in pages["/docs/guide/install"] and "Call the API" not in pages["/docs/guide/install"]


def test_without_a_site_url_and_with_a_project_llms_txt(tmp_path: Path) -> None:
    (tmp_path / "llms.txt").write_text("# Hand written\n", encoding="utf-8")
    out = _build(tmp_path, site_url=None)
    assert (out / "llms.txt").read_text(encoding="utf-8") == "# Hand written\n"
    assert "Source: /docs/guide/setup\n" in (out / "llms-full.txt").read_text(encoding="utf-8")
    assert "[setup](/docs/guide/setup.md#first)" in (out / "docs/guide/install.md").read_text(encoding="utf-8")


def test_accept_markdown_on_aiui_serve(tmp_path: Path) -> None:
    from starlette.testclient import TestClient

    from praisonaiui.cli import _static_site_app

    client = TestClient(_static_site_app(_build(tmp_path)))
    res = client.get("/docs/guide/install", headers={"Accept": "text/markdown, text/html;q=0.9"})
    assert res.headers["content-type"].startswith("text/markdown") and res.headers["vary"] == "Accept"
    assert res.text.startswith("# Install\n")
    assert client.get("/", headers={"Accept": "text/markdown"}).text.startswith("# Home\n")
    browser = client.get("/docs/guide/install", headers={"Accept": "text/html,application/xhtml+xml,*/*;q=0.8"})
    assert browser.headers["content-type"].startswith("text/html")
    for accept in ("text/html, text/markdown", "text/markdown"):
        assert prefers_markdown(accept)
    for accept in ("text/markdown;q=0.5, text/html", "", "text/markdown;q=0", "*/*"):
        assert not prefers_markdown(accept)
    for accept in ("text/markdown;q=.", "text/markdown;q=1.0.0"):  # malformed q: no 500
        assert isinstance(prefers_markdown(accept), bool)


def test_api_fields_and_examples_become_plain_markdown() -> None:
    src = (
        '<ParamField path="user_id" type="string" required>\nThe user.\n</ParamField>\n\n'
        '<ResponseField name="user" type="object">\n  The user.\n  <Expandable title="props">\n'
        '    <ResponseField name="email" type="string" deprecated>Use `emails`.</ResponseField>\n'
        "  </Expandable>\n</ResponseField>\n\n<RequestExample>\n\n```bash cURL\ncurl x\n```\n\n</RequestExample>\n"
        "<Panel>\nSide note.\n</Panel>\n"
    )
    md = to_agent_markdown(src, title="T")
    assert "- `user_id` (path, string, required): The user.\n" in md
    assert "- `user` (object): The user.\n  - `email` (string, deprecated): Use `emails`." in md
    assert "**Request example**\n\n```bash cURL\ncurl x\n```" in md and "Side note." in md
    assert "Field" not in md and "Expandable" not in md and "Panel" not in md


def test_video_embeds_become_links() -> None:
    """<iframe> and <video> (a page's raw HTML media) are links in the agent .md; code keeps them."""
    source = "\n".join(
        [
            '<iframe width="560" src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Tour" allowfullscreen></iframe>',
            "",
            '<video autoPlay muted loop playsInline src="/videos/loop.mp4"></video>',
            "",
            "<video controls>",
            '  <source src="clip.webm" type="video/webm" />',
            "</video>",
            "",
            "`<iframe src=x>`",
        ]
    )
    md = to_agent_markdown(source, title="Media", site="https://docs.example.com", page_dir="/docs/guide")
    assert "[Tour](https://www.youtube.com/embed/dQw4w9WgXcQ)" in md
    assert "[Video](https://docs.example.com/videos/loop.mp4)" in md
    assert "[Video](https://docs.example.com/docs/guide/clip.webm)" in md
    assert "<video" not in md and "<source" not in md
    assert "`<iframe src=x>`" in md
