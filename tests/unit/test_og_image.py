"""Social cards: a generated 1200x630 og:image per docs page (compiler/og_image.py)."""

import json
import re
from pathlib import Path

import pytest

from praisonaiui.compiler import Compiler
from praisonaiui.compiler import og_image as og
from praisonaiui.schema.models import Config

PAGES = {
    "index.md": "# Home\n\nWelcome to the documentation for the Acme platform.\n",
    "guide/plain.md": "---\ntitle: Plain\ndescription: A plain page.\n---\n# Plain\n",
    "guide/own.md": "---\ntitle: Own\n'og:image': /mine.png\n---\n# Own\n",
}


def _build(tmp_path: Path, **seo):
    for name, text in PAGES.items():
        (tmp_path / "docs" / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / "docs" / name).write_text(text, encoding="utf-8")
    config = Config.model_validate({
        "site": {"title": "Acme Docs", "theme": {"preset": "blue"}},
        "seo": {"siteUrl": "https://docs.acme.test", "defaultImage": "/default.png", **seo},
        "content": {"docs": {"dir": "docs"}},
    })
    out = tmp_path / "site"
    result = Compiler(config, base_path=tmp_path).compile(output_dir=out)
    assert result.success
    return out, result


def _tag(html: str, key: str) -> list[str]:
    return re.findall(rf'<meta (?:name|property)="{re.escape(key)}" content="([^"]*)"', html)


def _nav_seo(out: Path, path: str) -> dict:
    def walk(items):
        for item in items:
            yield item
            yield from walk(item.get("children") or [])

    nav = json.loads((out / "docs-nav.json").read_text())
    return next(i for i in walk(nav["items"]) if i.get("path") == path).get("seo", {})


@pytest.fixture
def drawn(monkeypatch):
    """Pillow 'installed', drawing stubbed: the tag wiring, tested without Pillow."""
    calls: dict = {}

    def write(cards, output_dir, cache, fonts):
        calls.update(cards)
        return [og.card_path(route) for route in cards]

    monkeypatch.setattr(og, "available", lambda: True)
    monkeypatch.setattr(og, "write", write)
    monkeypatch.setattr(og, "style", lambda theme, dark: {"accent": "#2563eb"})
    return calls


def test_each_page_gets_its_card_as_og_and_twitter_image(tmp_path: Path, drawn) -> None:
    out, result = _build(tmp_path)
    html = (out / "docs/guide/plain.html").read_text()
    assert _tag(html, "og:image") == ["https://docs.acme.test/og/docs/guide/plain.png"]
    assert _tag(html, "twitter:image") == ["https://docs.acme.test/og/docs/guide/plain.png"]
    assert _tag(html, "twitter:card") == ["summary_large_image"]
    assert "og/docs/guide/plain.png" in result.files and not result.notes
    card = drawn["/docs/guide/plain"]
    assert (card.title, card.description, card.eyebrow, card.site, card.host) == (
        "Plain", "A plain page.", "Guide", "Acme Docs", "docs.acme.test")
    # The docs app sets the same image on client navigation
    assert _nav_seo(out, "/docs/guide/plain") == {"og:image": "/og/docs/guide/plain.png"}
    # The site root carries the docs home's card
    assert _tag((out / "index.html").read_text(), "og:image") == ["https://docs.acme.test/og/docs/index.png"]


def test_a_pages_own_og_image_wins_and_gets_no_card(tmp_path: Path, drawn) -> None:
    out, _ = _build(tmp_path)
    assert _tag((out / "docs/guide/own.html").read_text(), "og:image") == ["https://docs.acme.test/mine.png"]
    assert "/docs/guide/own" not in drawn


@pytest.mark.parametrize("seo", [{"ogImages": False}, {"metatags": {"og:image": "/site.png"}}])
def test_turned_off_or_set_site_wide(tmp_path: Path, drawn, seo) -> None:
    out, result = _build(tmp_path, **seo)
    assert not drawn and not result.notes and "og:image" not in _nav_seo(out, "/docs/guide/plain")
    want = "/site.png" if "metatags" in seo else "/default.png"
    assert _tag((out / "docs/guide/plain.html").read_text(), "og:image") == [f"https://docs.acme.test{want}"]


def test_without_pillow_the_build_keeps_the_default_and_says_so_once(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(og, "available", lambda: False)
    out, result = _build(tmp_path)
    assert result.notes == [og.NOTE] and "pip install pillow" in og.NOTE
    assert _tag((out / "docs/guide/plain.html").read_text(), "og:image") == ["https://docs.acme.test/default.png"]
    assert not (out / "og").exists()


def test_card_paths_and_keys() -> None:
    assert og.card_path("/docs/guide/plain") == "og/docs/guide/plain.png"
    assert og.card_path("/") == "og/index.png"
    card = og.Card(title="A")
    assert og.card_key(card) == og.card_key(og.Card(title="A"))
    assert og.card_key(card) != og.card_key(og.Card(title="B"))


def test_a_card_is_a_1200x630_png_and_cached_by_content(tmp_path: Path, monkeypatch) -> None:
    pytest.importorskip("PIL")
    from PIL import Image

    logo = tmp_path / "logo.png"
    Image.new("RGB", (120, 40), "#e11d48").save(logo)
    long = "Configure authentication and single sign-on for your whole organization " * 3
    cards = {
        "/docs/a": og.Card(title=long, description=long, eyebrow="Guide", site="Acme", host="acme.test",
                           logo=str(logo), **og.style(None, True)),
        "/docs/b": og.Card(title="认证与单点登录", site="Acme", **og.style(None, False)),
    }
    fonts = [Path(og.__file__).parent.parent / "templates" / "frontend" / "assets"]
    files = og.write(cards, tmp_path / "out", tmp_path / "cache", fonts)
    assert files == ["og/docs/a.png", "og/docs/b.png"]
    for rel in files:
        with Image.open(tmp_path / "out" / rel) as img:
            assert (img.format, img.size) == ("PNG", (1200, 630))
    assert len(list((tmp_path / "cache").glob("*.png"))) == 2

    def boom(*_args):
        raise AssertionError("a cached card was drawn again")

    monkeypatch.setattr(og, "render", boom)
    (tmp_path / "out" / files[0]).unlink()
    og.write(cards, tmp_path / "out", tmp_path / "cache", fonts)
    assert (tmp_path / "out" / files[0]).is_file()


def test_card_colours_follow_the_theme() -> None:
    pytest.importorskip("PIL")
    theme = Config.model_validate({"site": {"title": "x", "theme": {"accent": "#0f766e"}}}).site.theme
    assert og.style(theme, False)["accent"] == "#0f766e"
    assert og.style(theme, False)["background"] == "#ffffff"
    odd = Config.model_validate({"site": {"title": "x", "theme": {"accent": "oklch(0.6 0.2 250)"}}}).site.theme
    assert og.style(odd, True)["accent"].startswith("#")  # unreadable colour: the preset's accent
