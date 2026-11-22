"""`aiui build` names the entry files by their content and can use another build.

index.js and index.css keep their names in the bundle while the chunks they
load are content-hashed. A static host such as GitHub Pages ignores the query
string, so ``?v=`` alone let a cached old page get the new entry (or the
reverse). The site loads content-named copies (``index-<sha256[:10]>.js``);
the originals stay so an old page's URL still resolves.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import pytest

from praisonaiui.compiler import Compiler
from praisonaiui.schema.models import Config, SiteConfig

INDEX_HTML = """<!doctype html>
<html lang="en">
<head>
  <title>Documentation</title>
  <script>var d=__AIUI_DARK_DEFAULT__;</script>
  <link rel="stylesheet" href="/assets/theme.css">
  <script type="module" crossorigin src="/assets/index.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/preload-helper-BXl3LOEh.js">
  <link rel="stylesheet" crossorigin href="/assets/index.css">
</head>
<body><div id="root"></div></body>
</html>
"""


def _fake_build(root: Path, *, manifest: bool = True, js: str = "console.log('entry')") -> Path:
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (root / "icon.svg").write_text("<svg/>", encoding="utf-8")
    (root / "assets" / "index.js").write_text(js, encoding="utf-8")
    (root / "assets" / "index.css").write_text("body{margin:0}", encoding="utf-8")
    (root / "assets" / "preload-helper-BXl3LOEh.js").write_text("export{}", encoding="utf-8")
    if manifest:
        (root / "aiui-manifest.json").write_text(
            '{"index.html": {"file": "assets/index.js", "isEntry": true}}', encoding="utf-8"
        )
    return root


def _sha10(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def _compile(tmp_path: Path, with_docs: bool = False) -> Path:
    data: dict = {"site": SiteConfig(title="Versions")}
    if with_docs:
        docs = tmp_path / "docs"
        docs.mkdir()
        (docs / "guide.md").write_text("# Guide\n\nText.\n", encoding="utf-8")
        data["content"] = {"docs": {"dir": "./docs"}}
    out = tmp_path / "site"
    result = Compiler(Config(**data), base_path=tmp_path).compile(out)
    assert result.success, result.error
    return out


@pytest.fixture
def build_dir(tmp_path, monkeypatch) -> Path:
    build = _fake_build(tmp_path / "build")
    monkeypatch.setenv("AIUI_TEMPLATES_DIR", str(build))
    return build


def test_index_html_references_entry_files_by_content_name(tmp_path, build_dir):
    out = _compile(tmp_path)
    html = (out / "index.html").read_text(encoding="utf-8")

    js = _sha10(out / "assets" / "index.js")
    css = _sha10(out / "assets" / "index.css")
    assert f'src="/assets/index-{js}.js"' in html
    assert f'href="/assets/index-{css}.css"' in html
    assert "?v=" not in html.split("plugin-loader")[0], "the host ignores ?v=: the name carries the build"
    # the copies are byte for byte the entry files
    assert (out / "assets" / f"index-{js}.js").read_bytes() == (out / "assets" / "index.js").read_bytes()
    assert (out / "assets" / f"index-{css}.css").read_bytes() == (out / "assets" / "index.css").read_bytes()
    # nothing else is rewritten
    assert 'href="/assets/preload-helper-BXl3LOEh.js"' in html
    assert 'href="/assets/theme.css"' in html
    assert "__AIUI_DARK_DEFAULT__" not in html


def test_old_fixed_entry_urls_still_resolve(tmp_path, build_dir):
    """A page cached before the deploy asks for /assets/index.js?v=...: it must still be there."""
    out = _compile(tmp_path)
    assert (out / "assets" / "index.js").read_text(encoding="utf-8") == "console.log('entry')"
    assert (out / "assets" / "index.css").is_file()


def test_site_manifest_lists_the_entry_copies_for_the_carry_forward(tmp_path, build_dir):
    out = _compile(tmp_path)
    manifest = json.loads((out / "aiui-manifest.json").read_text(encoding="utf-8"))
    files = {c["file"] for c in manifest.values()}
    js, css = _sha10(out / "assets" / "index.js"), _sha10(out / "assets" / "index.css")
    assert {f"assets/index-{js}.js", f"assets/index-{css}.css"} <= files
    assert manifest["index.html"]["file"] == "assets/index.js", "the bundle's own entries are kept"
    # the bundle's manifest is not touched
    assert "index-" not in (build_dir / "aiui-manifest.json").read_text(encoding="utf-8")


def test_version_follows_the_file_content(tmp_path, monkeypatch):
    first = _fake_build(tmp_path / "a", js="console.log(1)")
    second = _fake_build(tmp_path / "b", js="console.log(2)")
    versions = []
    for i, build in enumerate((first, second, first)):
        monkeypatch.setenv("AIUI_TEMPLATES_DIR", str(build))
        html = (_compile(tmp_path / f"run{i}") / "index.html").read_text(encoding="utf-8")
        versions.append(re.search(r"/assets/index-([0-9a-f]{10})\.js", html).group(1))
    assert versions[0] != versions[1], "a changed entry must get a new URL"
    assert versions[0] == versions[2], "the same entry must keep its URL (cacheable)"


def test_fallback_and_route_pages_carry_the_same_entry(tmp_path, build_dir):
    out = _compile(tmp_path, with_docs=True)
    index = (out / "index.html").read_text(encoding="utf-8")
    wanted = re.findall(r"/assets/index-[0-9a-f]{10}\.(?:js|css)", index)
    assert len(wanted) == 2

    pages = [out / "404.html", *sorted(out.glob("docs/**/*.html"))]
    assert len(pages) >= 2, "expected 404.html and at least one docs route page"
    for page in pages:
        html = page.read_text(encoding="utf-8")
        for ref in wanted:
            assert ref in html, f"{page.relative_to(out)} is missing {ref}"
        assert not re.search(r'/assets/index\.(?:js|css)["?]', html), (
            f"{page.name} still loads a fixed-name entry"
        )


def test_compiling_twice_does_not_stack_names(tmp_path, build_dir):
    _compile(tmp_path)
    out = _compile(tmp_path)
    html = (out / "index.html").read_text(encoding="utf-8")
    assert len(re.findall(r"/assets/index-[0-9a-f]{10}\.js", html)) == 1
    assert sorted(p.name for p in (out / "assets").glob("index-*.js")) == [
        f"index-{_sha10(out / 'assets' / 'index.js')}.js"
    ]


def test_entry_imported_by_a_chunk_keeps_its_fixed_name(tmp_path, monkeypatch):
    """A chunk that imports ./index.js would load the entry a second time under a
    renamed copy, so the build falls back to index.js?v=."""
    build = _fake_build(tmp_path / "build")
    (build / "aiui-manifest.json").write_text(json.dumps({
        "index.html": {"file": "assets/index.js", "isEntry": True},
        "_late.js": {"file": "assets/late-AAAAAAAA.js", "imports": ["index.html"]},
    }), encoding="utf-8")
    monkeypatch.setenv("AIUI_TEMPLATES_DIR", str(build))
    out = _compile(tmp_path)
    html = (out / "index.html").read_text(encoding="utf-8")
    assert f'src="/assets/index.js?v={_sha10(out / "assets" / "index.js")}"' in html
    assert not list((out / "assets").glob("index-*"))


def test_base_path_prefixes_the_entry_copies(tmp_path, build_dir):
    out = tmp_path / "site"
    result = Compiler(Config(site=SiteConfig(title="Versions")), base_path=tmp_path, url_base="/repo").compile(out)
    assert result.success, result.error
    html = (out / "index.html").read_text(encoding="utf-8")
    assert re.search(r'src="/repo/assets/index-[0-9a-f]{10}\.js"', html)
    assert re.search(r'href="/repo/assets/index-[0-9a-f]{10}\.css"', html)


def test_bundle_without_manifest_keeps_unversioned_entry(tmp_path, monkeypatch):
    """Bundles built before chunks were hashed have chunks that import
    ``./index.js``; loading the entry as ``index.js?v=...`` would run it twice."""
    monkeypatch.setenv("AIUI_TEMPLATES_DIR", str(_fake_build(tmp_path / "old", manifest=False)))
    out = _compile(tmp_path)
    html = (out / "index.html").read_text(encoding="utf-8")
    assert 'src="/assets/index.js"' in html
    assert re.search(r'href="/assets/index\.css\?v=[0-9a-f]{10}"', html)
    assert not (out / "aiui-manifest.json").exists()


def test_templates_dir_override_supplies_build_and_packaged_plugins(tmp_path, build_dir):
    out = _compile(tmp_path)
    assert (out / "assets" / "index.js").read_text(encoding="utf-8") == "console.log('entry')"
    assert (out / "icon.svg").is_file()
    # the build manifest travels with the site (deploys use it to keep old chunks)
    assert (out / "aiui-manifest.json").is_file()
    # a build-only directory has no plugins/: the packaged loader is still copied
    assert (out / "plugins" / "plugin-loader.js").is_file()
    assert "plugin-loader.js" in (out / "index.html").read_text(encoding="utf-8")


def test_packaged_bundle_is_used_without_override(tmp_path, monkeypatch):
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    out = _compile(tmp_path)
    packaged = (
        Path(__file__).resolve().parents[2] / "src" / "praisonaiui" / "templates" / "frontend"
    )
    assert (out / "assets" / "index.js").read_bytes() == (
        packaged / "assets" / "index.js"
    ).read_bytes()
    html = (out / "index.html").read_text(encoding="utf-8")
    assert f"/assets/index-{_sha10(out / 'assets' / 'index.css')}.css" in html
    assert f"/assets/index-{_sha10(out / 'assets' / 'index.js')}.js" in html
