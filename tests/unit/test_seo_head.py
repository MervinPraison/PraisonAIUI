"""Page SEO head: overrides, seo.metatags / seo.paths, JSON-LD @graph, description fallback."""

import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from praisonaiui.compiler import Compiler
from praisonaiui.compiler.docs_scanner import DocsScanner
from praisonaiui.schema.models import Config

PAGES = {
    "index.md": "# Home\n\nWelcome to the documentation for the Acme platform.\n",
    "guide/install.md": (
        "---\ntitle: Install\ndescription: Install it.\ncanonical: https://other.test/x\n"
        "'og:image': /x.png\n'twitter:card': summary\nkeywords: [setup, cli]\n---\n# Install\n"
    ),
    "guide/plain.md": "---\ntitle: Plain\n---\n# Plain\n\nA plain page that has no overrides at all.\n",
    "v1/old.md": "---\ntitle: Old\n'og:title': Old \"quoted\" <b>\n---\n# Old\n\nThe old version of the API docs.\n",
}


def _build(tmp_path: Path, **seo) -> Path:
    for name, text in PAGES.items():
        (tmp_path / "docs" / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / "docs" / name).write_text(text, encoding="utf-8")
    config = Config.model_validate({
        "site": {"title": "Acme Docs"},
        "logo": {"light": "/logo.svg"},
        "seo": {"siteUrl": "https://docs.acme.test", "defaultImage": "/og.png", **seo},
        "content": {"docs": {"dir": "docs"}},
        "templates": {"docs": {"layout": "ThreeColumnLayout", "slots": {}}},
        "routes": [{"match": "/docs/**", "template": "docs"}],
    })
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def _tag(html: str, key: str) -> list[str]:
    return re.findall(rf'<meta (?:name|property)="{re.escape(key)}" content="([^"]*)"', html)


def _graph(html: str) -> dict:
    scripts = re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', html)
    assert len(scripts) == 1
    return {node["@type"]: node for node in json.loads(scripts[0])["@graph"]}


def test_frontmatter_overrides_reach_the_static_head(tmp_path: Path) -> None:
    html = (_build(tmp_path) / "docs/guide/install.html").read_text()
    assert html.count('rel="canonical"') == 1 and '<link rel="canonical" href="https://other.test/x" />' in html
    assert _tag(html, "og:url") == ["https://other.test/x"]  # follows the canonical
    assert _tag(html, "og:image") == ["https://docs.acme.test/x.png"]  # root-relative made absolute
    assert _tag(html, "twitter:image") == ["https://docs.acme.test/x.png"]
    assert _tag(html, "twitter:card") == ["summary"]  # the page's own value wins
    assert _tag(html, "keywords") == ["setup, cli"]
    assert _tag(html, "og:type") == ["article"]  # the template's `website` is replaced, not repeated
    assert _tag(html, "og:site_name") == ["Acme Docs"]
    assert html.count('name="robots"') == 1


def test_defaults_use_a_large_card_with_an_image(tmp_path: Path) -> None:
    html = (_build(tmp_path) / "docs/guide/plain.html").read_text()
    assert _tag(html, "og:image") == ["https://docs.acme.test/og.png"]
    assert _tag(html, "twitter:card") == ["summary_large_image"]
    assert '<link rel="canonical" href="https://docs.acme.test/docs/guide/plain" />' in html


def test_metatags_and_paths_cascade_and_escape(tmp_path: Path) -> None:
    out = _build(
        tmp_path,
        metatags={"google-site-verification": "abc123", "og:locale": "en_GB"},
        paths=[
            {"path": "v1", "metatags": {"robots": "noindex", "og:locale": "de_DE"}},
            {"path": "/docs/v1/old", "metatags": {"og:locale": "fr_FR"}},
        ],
    )
    plain = (out / "docs/guide/plain.html").read_text()
    assert _tag(plain, "google-site-verification") == ["abc123"]
    assert _tag(plain, "og:locale") == ["en_GB"]  # replaces the template's en_US
    old = (out / "docs/v1/old.html").read_text()
    assert _tag(old, "og:locale") == ["fr_FR"]  # the longest path wins
    assert '<meta name="robots" content="noindex" />' in old and old.count('name="robots"') == 1
    assert _tag(old, "og:title") == ["Old &quot;quoted&quot; &lt;b&gt;"]  # escaped (R9)
    # A folder's robots noindex keeps its pages out of the sitemap and llms.txt too.
    assert "v1/old" not in (out / "sitemap.xml").read_text()
    assert "v1/old" not in (out / "llms.txt").read_text()
    # The browser gets the same tags: global ones in ui-config, the rest per page.
    assert json.loads((out / "ui-config.json").read_text())["seo"]["metatags"]["og:locale"] == "en_GB"
    nav = json.dumps(json.loads((out / "docs-nav.json").read_text()))
    assert '"og:locale": "fr_FR"' in nav and '"canonical": "https://other.test/x"' in nav


def test_a_bad_metatag_name_is_rejected() -> None:
    with pytest.raises(ValidationError, match="not a meta tag name"):
        Config.model_validate({"site": {"title": "x"}, "seo": {"metatags": {'a" onload="x': "1"}}})


def test_json_ld_graph(tmp_path: Path) -> None:
    out = _build(tmp_path, organization={"name": "Acme Inc", "sameAs": ["https://github.com/acme"]})
    graph = _graph((out / "docs/guide/install.html").read_text())
    org, site, article = graph["Organization"], graph["WebSite"], graph["TechArticle"]
    assert org["name"] == "Acme Inc" and org["logo"]["url"] == "https://docs.acme.test/logo.svg"
    assert org["sameAs"] == ["https://github.com/acme"]
    assert site["publisher"] == {"@id": org["@id"]}
    assert site["potentialAction"]["target"]["urlTemplate"] == "https://docs.acme.test/?q={search_term_string}"
    assert article["url"] == "https://other.test/x" and article["keywords"] == "setup, cli"
    assert article["publisher"] == {"@id": org["@id"]} and article["isPartOf"] == {"@id": site["@id"]}
    home = (out / "index.html").read_text()
    assert _graph(home)["WebSite"]["url"] == "https://docs.acme.test/"
    assert home.count('rel="canonical"') == 1 and len(_tag(home, "og:type")) == 1


@pytest.mark.parametrize(
    "body",
    [
        '<Frame caption="A caption that is long enough to be taken">\n\nThe real first paragraph of this page.\n',
        '<img\n  src="/images/a-long-screenshot-name.png"\n  noZoom\n/>\n\nThe real first paragraph of this page.\n',
        "import { Card } from '../components/card'\n\nThe real first paragraph of this page.\n",
    ],
)
def test_description_fallback_skips_components(tmp_path: Path, body: str) -> None:
    assert DocsScanner(tmp_path)._extract_description(body) == "The real first paragraph of this page."


def test_description_fallback_strips_inline_tags(tmp_path: Path) -> None:
    text = "Run <code>aiui build</code> to publish the <Badge>new</Badge> site.\n"
    assert DocsScanner(tmp_path)._extract_description(text) == "Run aiui build to publish the new site."
