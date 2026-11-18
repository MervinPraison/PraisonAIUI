"""What `aiui build` publishes: excluded files never ship; hidden and noindex
pages stay out of the sitemap, llms files and search; one robots meta per
page; robots.txt / sitemap.xml overrides; seo.indexing and trailingSlash."""

from __future__ import annotations

import json
from pathlib import Path

import yaml
from typer.testing import CliRunner

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.compiler.publish import content_signal, is_excluded, robots_content, with_slash
from praisonaiui.schema.models import Config

DOCS = {
    "index.md": "---\ntitle: Home\n---\n# Home\n\nWelcome to the docs home page.\n",
    "guide/setup.md": "# Setup\n\nInstall it.\n",
    "beta.md": "---\ntitle: Beta\nhidden: true\n---\n# Beta\n\nSecret beta feature text.\n",
    "old.md": "---\ntitle: Old\nnoindex: true\n---\n# Old\n\nLegacy page text.\n",
    "drafts/plan.md": "# Plan\n\nUnreleased roadmap.\n",
    "drafts/shot.png": "png",
    "internal/notes.md": "# Notes\n\nInternal.\n",
    "guide/keys.secret.md": "# Keys\n",
}


def _site(tmp_path: Path, seo: str = "", extra: str = "", docs: dict | None = None) -> Path:
    for rel, text in (docs or DOCS).items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    (tmp_path / "aiui.yaml").write_text(
        f"""
site: {{title: T}}
seo: {{siteUrl: "https://ex.com"{seo}}}
content:
  docs: {{dir: docs, exclude: ["drafts/*"]}}
templates: {{docs: {{layout: Default, slots: {{}}}}}}
routes: [{{match: "/docs/**", template: docs}}]
{extra}
""",
        encoding="utf-8",
    )
    return tmp_path / "aiui.yaml"


def _build(tmp_path: Path, **kw):
    cfg_path = _site(tmp_path, **kw)
    cfg = Config.model_validate(yaml.safe_load(cfg_path.read_text()))
    out = tmp_path / "site"
    result = Compiler(cfg, base_path=tmp_path).compile(output_dir=out)
    assert result.success, result.error
    return out, result


def _read(out: Path, name: str) -> str:
    return (out / name).read_text(encoding="utf-8")


def _search_paths(out: Path) -> set[str]:
    return {p["p"] for p in json.loads(_read(out, "search-index.json"))["pages"]}


# ── M199: exclude leak ─────────────────────────────────────────────


def test_excluded_files_are_not_published(tmp_path: Path) -> None:
    (tmp_path / ".aiuiignore").write_text("# private\ninternal/\n*.secret.md\n", encoding="utf-8")
    out, result = _build(tmp_path)
    assert not (out / "docs" / "drafts").exists()  # pages and assets alike
    assert not (out / "docs" / "internal").exists()
    assert not (out / "docs" / "guide" / "keys.secret.md").exists()
    assert (out / "docs" / "guide" / "setup.md").exists()
    assert sorted(result.excluded) == ["drafts/plan.md", "drafts/shot.png", "guide/keys.secret.md", "internal/"]
    nav = _read(out, "docs-nav.json")
    assert "drafts" not in nav and "internal" not in nav and "secret" not in nav


def test_exclude_patterns() -> None:
    assert is_excluded("drafts/a/b.md", ["drafts"])
    assert is_excluded("drafts/a/b.md", ["drafts/"])
    assert is_excluded("x/tmp.log", ["*.log"])
    assert not is_excluded("x/drafts.md", ["/drafts"])
    assert not is_excluded("drafts/keep.md", ["drafts/", "!drafts/keep.md"])


def test_build_prints_what_it_excluded(tmp_path: Path) -> None:
    from praisonaiui.cli import app

    cfg = _site(tmp_path)
    res = CliRunner().invoke(app, ["build", "--config", str(cfg), "--output", str(tmp_path / "site")])
    assert res.exit_code == 0, res.output
    assert "Not published (2" in res.output and "drafts/plan.md" in res.output


# ── M083 / M063 / M084: hidden and noindex ─────────────────────────


def test_hidden_and_noindex_pages(tmp_path: Path) -> None:
    out, _ = _build(tmp_path)
    nav = json.loads(_read(out, "docs-nav.json"))["items"]
    beta = next(i for i in nav if i["title"] == "Beta")
    old = next(i for i in nav if i["title"] == "Old")
    assert beta["hidden"] and beta["noindex"]  # routable, not in the sidebar
    assert old["noindex"] and "hidden" not in old  # in the sidebar, not indexed

    for page in ("beta", "old"):
        html = _read(out, f"docs/{page}.html")  # the page is built
        assert html.count('name="robots"') == 1
        assert '<meta name="robots" content="noindex" />' in html  # links still followed
        for name in ("sitemap.xml", "llms.txt", "llms-full.txt"):
            assert f"/docs/{page}" not in _read(out, name)
        assert f"/docs/{page}" not in _search_paths(out)
    assert "Beta" not in _read(out, "docs/guide/setup.html").split('<nav aria-label="Documentation">')[1].split("</nav>")[0]

    setup = _read(out, "docs/guide/setup.html")
    assert setup.count('name="robots"') == 1 and 'content="index, follow"' in setup
    assert _read(out, "index.html").count('name="robots"') == 1
    assert '<meta name="robots" content="noindex" />' in _read(out, "404.html")


def test_indexing_all_indexes_hidden_pages(tmp_path: Path) -> None:
    out, _ = _build(tmp_path, seo=", indexing: all")
    assert "https://ex.com/docs/beta" in _read(out, "sitemap.xml")
    assert "/docs/beta" in _search_paths(out)
    assert 'content="index, follow"' in _read(out, "docs/beta.html")
    assert "/docs/old" not in _read(out, "sitemap.xml")  # explicit noindex still wins
    beta = next(i for i in json.loads(_read(out, "docs-nav.json"))["items"] if i["title"] == "Beta")
    assert beta["hidden"] and "noindex" not in beta


def test_hidden_group_and_tab(tmp_path: Path) -> None:
    extra = """
navigation:
  tabs:
    - tab: Docs
      groups:
        - {group: Start, pages: [index, guide/setup]}
        - {group: Lab, hidden: true, pages: [old]}
    - tab: Internal
      hidden: true
      groups: [{group: Private, pages: [beta]}]
"""
    cfg_path = _site(tmp_path, extra=extra)
    data = yaml.safe_load(cfg_path.read_text())
    data["content"]["docs"]["nav"] = {"mode": "manual"}
    out = tmp_path / "site"
    assert Compiler(Config.model_validate(data), base_path=tmp_path).compile(output_dir=out).success
    pages = {}
    for item in json.loads(_read(out, "docs-nav.json"))["items"]:
        for child in item.get("children", [item]):
            pages[child["title"]] = child
    assert pages["Old"]["hidden"] and pages["Beta"]["hidden"] and "hidden" not in pages["Setup"]
    tabs = json.loads(_read(out, "ui-config.json"))["navigation"]["tabs"]
    assert [t["tab"] for t in tabs] == ["Docs"]
    assert (out / "docs" / "beta.html").exists()


# ── M061 / M088 / M212: sitemap ────────────────────────────────────


def test_no_synthetic_folder_routes(tmp_path: Path) -> None:
    out, _ = _build(tmp_path)
    assert not (out / "docs" / "guide.html").exists()
    sitemap = _read(out, "sitemap.xml")
    assert "https://ex.com/docs/guide/setup" in sitemap
    assert "https://ex.com/docs/guide<" not in sitemap
    guide = next(i for i in json.loads(_read(out, "docs-nav.json"))["items"] if i["title"] == "Guide")
    assert "path" not in guide


def test_trailing_slash(tmp_path: Path) -> None:
    out, _ = _build(tmp_path, seo=", trailingSlash: true")
    setup = _read(out, "docs/guide/setup.html")
    assert '<link rel="canonical" href="https://ex.com/docs/guide/setup/" />' in setup
    assert '<meta property="og:url" content="https://ex.com/docs/guide/setup/" />' in setup
    assert 'id="aiui-canonical-url"' not in setup  # the URL bar keeps its slash
    assert "<loc>https://ex.com/docs/guide/setup/</loc>" in _read(out, "sitemap.xml")
    assert "Source: https://ex.com/docs/guide/setup/\n" in _read(out, "llms-full.txt")
    assert json.loads(_read(out, "ui-config.json"))["seo"]["trailingSlash"] is True
    assert with_slash("https://ex.com/a?x=1#h") == "https://ex.com/a/?x=1#h"


def test_custom_sitemap_and_robots_win(tmp_path: Path) -> None:
    (tmp_path / "sitemap.xml").write_text("<urlset>mine</urlset>\n", encoding="utf-8")
    (tmp_path / "robots.txt").write_text("User-agent: *\nDisallow: /private\n", encoding="utf-8")
    out, _ = _build(tmp_path)
    assert _read(out, "sitemap.xml") == "<urlset>mine</urlset>\n"
    assert _read(out, "robots.txt") == "User-agent: *\nDisallow: /private\n"


# ── M062: robots.txt ───────────────────────────────────────────────


def test_site_wide_noindex(tmp_path: Path) -> None:
    out = tmp_path / "site"
    out.mkdir()
    (out / "sitemap.xml").write_text("stale")  # from an earlier, indexed build
    out, _ = _build(tmp_path, seo=", robots: {index: false}")
    robots = _read(out, "robots.txt")
    assert "Disallow: /" in robots and "Sitemap:" not in robots and "llms" not in robots
    for name in ("sitemap.xml", "llms.txt", "llms-full.txt"):
        assert not (out / name).exists()
    for page in ("index.html", "docs/guide/setup.html"):
        html = _read(out, page)
        assert html.count('name="robots"') == 1 and 'content="noindex"' in html


def test_follow_false_does_not_block_docs(tmp_path: Path) -> None:
    out, _ = _build(tmp_path, seo=", robots: {follow: false}")
    assert "Disallow" not in _read(out, "robots.txt")
    assert 'content="index, nofollow"' in _read(out, "docs/guide/setup.html")


def test_content_signal(tmp_path: Path) -> None:
    out, _ = _build(tmp_path, seo=", contentSignals: {search: true, aiInput: true, aiTrain: false}")
    assert "Content-Signal: search=yes, ai-input=yes, ai-train=no\n" in _read(out, "robots.txt")
    assert content_signal({"search": None, "ai_train": False}) == "Content-Signal: ai-train=no"
    assert content_signal(None) is None
    assert "Content-Signal" not in _read(_build(tmp_path / "plain")[0], "robots.txt")


def test_robots_content() -> None:
    assert robots_content(False, None) == "index, follow"
    assert robots_content(True, None) == "noindex"
    assert robots_content(True, {"follow": False}) == "noindex, nofollow"
    assert robots_content(False, {"index": False}) == "noindex"
