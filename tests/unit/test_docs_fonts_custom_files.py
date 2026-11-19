"""Fonts (site.theme.fonts) and the author's CSS/JS files (site.customCss, site.customJs) in a docs build."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from praisonaiui.compiler import Compiler
from praisonaiui.schema.models import Config
from praisonaiui.schema.validators import validate_config


def _config(tmp_path: Path, site: dict) -> Config:
    docs = tmp_path / "docs"
    docs.mkdir(exist_ok=True)
    (docs / "index.md").write_text("# Home\n\nWelcome.\n", encoding="utf-8")
    (docs / "guide.md").write_text("# Guide\n\nSteps.\n", encoding="utf-8")
    for name, text in {
        "fonts/brand.woff2": "wOF2",
        "fonts/brand-bold.ttf": "ttf",
        "styles/brand.css": ".brand-marker { color: red; }",
        "scripts/analytics.js": "window.__ran = 1",
        "scripts/widget.mjs": "export {}",
    }.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(text, encoding="utf-8")
    return Config.model_validate({"site": {"title": "Acme", **site}, "content": {"docs": {"dir": "docs"}}})


def _build(tmp_path: Path, **site) -> tuple[Path, Compiler, list[str]]:
    compiler = Compiler(_config(tmp_path, site), base_path=tmp_path)
    out = tmp_path / "out"
    result = compiler.compile(out)
    assert result.success, result.error
    return out, compiler, result.warnings


def _pages(out: Path) -> list[str]:
    return [(out / p).read_text(encoding="utf-8") for p in ("index.html", "404.html", "docs/guide.html")]


def test_a_google_family_loads_once_with_swap_and_sets_body_and_headings(tmp_path):
    out, compiler, _ = _build(tmp_path, theme={"fonts": "Inter"})
    for page in _pages(out):
        assert '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />' in page
        assert page.count("fonts.googleapis.com/css2?") == 1
        assert "family=Inter:wght@400;500;600;700&amp;display=swap" in page
    css = (out / "assets" / "theme.css").read_text()
    assert '--aiui-font-sans: "Inter", ui-sans-serif' in css
    assert '--aiui-font-display: "Inter"' in css
    assert ":root, :root [data-aiui-scope], :root .dark {" in css  # where the theme declares them
    assert "font-family: var(--aiui-font-display)" in css
    assert compiler.external_origins() == {
        "font-src": ["https://fonts.gstatic.com"], "style-src": ["https://fonts.googleapis.com"]}


def test_body_heading_and_code_fonts_each_set_their_variable(tmp_path):
    out, _, _ = _build(tmp_path, theme={"fonts": {
        "body": "Inter", "heading": {"family": "Fraunces", "weight": "100 900"},
        "code": {"family": "JetBrains Mono", "weight": [400, 600]}}})
    page = (out / "docs/guide.html").read_text()
    assert "family=Inter:wght@400;500;600;700&amp;family=Fraunces:wght@100..900" in page
    assert "family=JetBrains+Mono:wght@400;600" in page
    css = (out / "assets" / "theme.css").read_text()
    assert '--aiui-font-display: "Fraunces"' in css
    assert '--aiui-font-mono: "JetBrains Mono", ui-monospace' in css


def test_a_body_font_alone_leaves_the_headings_rule_out(tmp_path):
    out, _, _ = _build(tmp_path, theme={"fonts": {"code": "Fira Code"}})
    css = (out / "assets" / "theme.css").read_text()
    assert "--aiui-font-mono" in css and "--aiui-font-sans" not in css
    assert "font-family: var(--aiui-font-display)" not in css


def test_a_font_file_is_published_declared_and_preloaded_under_the_base_path(tmp_path):
    out, compiler, _ = _build(tmp_path, basePath="/acme", theme={"fonts": {"body": [
        {"family": "Brand Sans", "source": "fonts/brand.woff2", "weight": 400},
        {"family": "Brand Sans", "source": "fonts/brand-bold.ttf", "weight": 700},
    ]}})
    assert (out / "fonts" / "brand.woff2").read_text() == "wOF2"
    css = (out / "assets" / "theme.css").read_text()
    assert ('@font-face { font-family: "Brand Sans"; src: url("/acme/fonts/brand.woff2") format("woff2"); '
            "font-weight: 400; font-style: normal; font-display: swap; }") in css
    assert 'url("/acme/fonts/brand-bold.ttf") format("truetype"); font-weight: 700;' in css
    for page in _pages(out):
        assert '<link rel="preload" href="/acme/fonts/brand.woff2" as="font" type="font/woff2" crossorigin />' in page
        assert "fonts.googleapis.com" not in page
    assert compiler.external_origins() == {}


def test_a_hosted_font_url_is_used_as_is_and_listed_for_csp(tmp_path):
    out, compiler, _ = _build(tmp_path, theme={"fonts": {
        "body": {"family": "Brand", "source": 'https://cdn.example.com/b.woff2?x="1"'}}})
    css = (out / "assets" / "theme.css").read_text()
    assert 'src: url("https://cdn.example.com/b.woff2?x=1") format("woff2")' in css
    assert compiler.external_origins() == {"font-src": ["https://cdn.example.com"]}


@pytest.mark.parametrize("fonts", [
    'Inter"; } body { display: none',
    {"body": "Inter</style>"},
    {"body": {"family": "Inter", "weight": 450}},
    {"body": {"family": "Inter", "weight": "bold"}},
])
def test_a_font_family_or_weight_that_could_break_out_is_rejected(tmp_path, fonts):
    with pytest.raises(ValidationError):
        _config(tmp_path, {"theme": {"fonts": fonts}})


def test_custom_css_files_text_and_urls_load_last_in_order_on_every_page(tmp_path):
    out, compiler, _ = _build(tmp_path, basePath="/acme", customCss=[
        "styles/brand.css", ".inline-marker { color: blue; }", "https://cdn.example.com/x.css"])
    assert (out / "styles" / "brand.css").read_text() == ".brand-marker { color: red; }"
    assert (out / "assets" / "custom.css").read_text() == ".inline-marker { color: blue; }\n"
    for page in _pages(out):
        body = page.split("<body>", 1)[1]
        loader = body.index("plugin-loader.js")
        brand = body.index('<link rel="stylesheet" href="/acme/styles/brand.css?v=')
        inline = body.index('<link rel="stylesheet" href="/acme/assets/custom.css?v=')
        url = body.index('<link rel="stylesheet" href="https://cdn.example.com/x.css" />')
        assert loader < brand < inline < url < body.index("</body>")
    assert compiler.external_origins() == {"style-src": ["https://cdn.example.com"]}


def test_custom_css_as_one_css_string_now_reaches_the_build(tmp_path):
    out, _, _ = _build(tmp_path, customCss=":root { --seed-accent: #0f766e; }")
    assert "--seed-accent: #0f766e;" in (out / "assets" / "custom.css").read_text()
    assert "/assets/custom.css?v=" in (out / "docs/guide.html").read_text()


def test_custom_js_files_run_deferred_and_mjs_as_a_module(tmp_path):
    out, compiler, _ = _build(tmp_path, customJs=[
        "scripts/analytics.js", "scripts/widget.mjs", "https://plausible.io/js/script.js"])
    assert (out / "scripts" / "analytics.js").is_file()
    page = (out / "docs/guide.html").read_text()
    assert '<script defer src="/scripts/analytics.js?v=' in page
    assert '<script type="module" src="/scripts/widget.mjs?v=' in page
    assert '<script defer src="https://plausible.io/js/script.js"></script>' in page
    assert compiler.external_origins() == {"script-src": ["https://plausible.io"]}


def test_a_single_custom_js_path_is_enough(tmp_path):
    out, _, _ = _build(tmp_path, customJs="scripts/analytics.js")
    assert '<script defer src="/scripts/analytics.js?v=' in (out / "index.html").read_text()


def test_urls_are_escaped_in_the_page(tmp_path):
    out, _, _ = _build(tmp_path, customJs='https://x.example/a.js?"><script>alert(1)</script>')
    page = (out / "index.html").read_text()
    assert "<script>alert(1)" not in page
    assert "&quot;&gt;&lt;script&gt;" in page


def test_a_missing_or_outside_file_is_reported_and_left_out(tmp_path):
    (tmp_path.parent / "outside.css").write_text("x{}", encoding="utf-8")
    site = {"customCss": ["missing.css", "../outside.css"], "customJs": "nope.js",
            "theme": {"fonts": {"body": {"family": "Brand", "source": "fonts/none.woff2"}}}}
    out, _, warnings = _build(tmp_path, **site)
    page = (out / "index.html").read_text()
    assert "missing.css" not in page and "outside.css" not in page and "nope.js" not in page
    assert not (out / "outside.css").exists()
    assert any("missing.css" in w for w in warnings)
    issues = Compiler(_config(tmp_path, site), base_path=tmp_path).lint_content()
    found = sorted((i.code, i.file) for i in issues if i.code == 7014)
    assert found == [(7014, "site.customCss"), (7014, "site.customCss"), (7014, "site.customJs"),
                     (7014, "site.theme.fonts.body")]


def test_no_fonts_or_custom_files_leave_the_build_as_it_was(tmp_path):
    out, compiler, _ = _build(tmp_path)
    assert not (out / "assets" / "custom.css").exists()
    assert "@font-face" not in (out / "assets" / "theme.css").read_text()
    assert "fonts.googleapis.com" not in (out / "index.html").read_text()
    assert compiler.external_origins() == {}


def test_a_list_of_custom_css_still_gets_the_legacy_colour_check(tmp_path):
    config = _config(tmp_path, {"customCss": ["styles/brand.css", ":root { --primary: 221 83% 53%; }"]})
    result = validate_config(config, tmp_path)
    assert any(w.code == 5001 for w in result.warnings)
