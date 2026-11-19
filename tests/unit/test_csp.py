"""Content-Security-Policy of a docs build (compiler/csp.py, docs/features/content-security-policy.md)."""

from __future__ import annotations

import base64
import hashlib
import re
from pathlib import Path

import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient

from praisonaiui.cli import _static_site_app
from praisonaiui.compiler import Compiler, csp
from praisonaiui.schema.models import Config

META = re.compile(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)" />')


def _build(tmp_path: Path, url_base: str | None = None, page: str = "# Home\n\nHello.\n", **extra) -> Path:
    docs = tmp_path / "docs"
    docs.mkdir(parents=True, exist_ok=True)
    (docs / "index.md").write_text(page, encoding="utf-8")
    site = {"title": "C", **extra.pop("site", {})}
    config = Config.model_validate({"site": site, "content": {"docs": {"dir": "./docs"}}, **extra})
    out = tmp_path / "site"
    result = Compiler(config, base_path=tmp_path, url_base=url_base).compile(out)
    assert result.success, result.error
    return out


def _policy(text: str) -> dict[str, list[str]]:
    return {d.split()[0]: d.split()[1:] for d in text.split("; ")}


def _sha(js: str) -> str:
    return f"'sha256-{base64.b64encode(hashlib.sha256(js.encode()).digest()).decode()}'"


def test_hashes_only_the_inline_scripts_a_browser_runs():
    html = (
        "<script>a()</script><script type='module'>b()</script><script src=/x.js></script>"
        '<script type="application/ld+json">{"@context":1}</script>'
        '<script type="application/json" id="aiui-initial-doc">{}</script><script>c()\r\n</script>'
    )
    assert csp.inline_hashes(html) == {_sha("a()"), _sha("b()"), _sha("c()\n")}


def test_every_built_page_carries_the_policy_and_its_inline_scripts_are_allowed(tmp_path):
    out = _build(tmp_path, redirects=[{"source": "/docs/old", "destination": "/docs/index"}])
    pages = [out / "index.html", out / "404.html", out / "docs/index.html", out / "docs/old.html"]
    values = set()
    for page in pages:
        html = page.read_text(encoding="utf-8")
        found = META.search(html)
        assert found, page
        values.add(found.group(1))
        # charset first, the policy next, before any script
        assert html.index("<meta charset") < found.start() < html.index("<script")
    assert len(values) == 1
    policy = _policy(values.pop().replace("&#x27;", "'"))
    for page in pages:
        assert csp.inline_hashes(page.read_text(encoding="utf-8")) <= set(policy["script-src"])
    assert policy["script-src"][0] == "'self'" and "'unsafe-inline'" not in policy["script-src"]
    assert policy["object-src"] == ["'none'"] and "frame-ancestors" not in policy  # header only
    assert policy["connect-src"] == ["'self'"] and policy["frame-src"] == ["'self'"]
    header = (out / "_headers").read_text(encoding="utf-8")
    assert header.startswith("/*\n  Content-Security-Policy: default-src 'self'; ")
    assert header.rstrip().endswith("frame-ancestors 'self'")


def test_the_policy_names_what_the_build_loads(tmp_path):
    page = '# Home\n\n<iframe src="https://youtu.be/dQw4w9WgXcQ" title="Tour"></iframe>\n'
    out = _build(
        tmp_path, page=page,
        site={"theme": {"fonts": "Inter"}, "customJs": "https://cdn.example.com/x.js", "plugins": ["mermaid"]},
        navbar={"primary": {"type": "github", "href": "https://github.com/acme/site"}},
        integrations={"plausible": {"domain": "acme.dev"}},
        content={"docs": {"dir": "./docs", "assistant": {"endpoint": "https://ask.acme.dev/api/docs/ask"}}},
    )
    policy = _policy(csp.site_headers(out)[0][1].decode())
    assert "https://fonts.googleapis.com" in policy["style-src"] and "https://fonts.gstatic.com" in policy["font-src"]
    assert {"https://cdn.example.com", "https://cdn.jsdelivr.net", "https://plausible.io"} <= set(policy["script-src"])
    assert {"https://api.github.com", "https://ask.acme.dev", "https://plausible.io"} <= set(policy["connect-src"])
    assert policy["frame-src"] == ["'self'", "https://www.youtube-nocookie.com"]


def test_try_it_servers():
    assert csp.server_origins({"url": "https://api.acme.dev/v1"}) == {"https://api.acme.dev"}
    assert csp.server_origins({"url": "/api"}) == set()
    assert csp.server_origins({"url": "https://{r}.acme.dev:{p}/", "variables": {"r": {"enum": ["eu", "us"]}}}) == {
        "https://eu.acme.dev:*", "https://us.acme.dev:*"}
    assert csp.server_origins({"url": "https://{tenant}.acme.dev"}) == {"https://*.acme.dev"}
    assert csp.server_origins({"url": "https://api-{tenant}.acme.dev"}) == {"https:"}
    assert csp.server_origins({"url": "{base}/v1"}) == {"https:"}


def test_serve_sends_the_header_with_frame_ancestors(tmp_path):
    out = _build(tmp_path, "/repo")
    response = TestClient(_static_site_app(out)).get("/repo/docs/index")
    assert response.status_code == 200
    value = response.headers["content-security-policy"]
    assert value.endswith("frame-ancestors 'self'") and "script-src 'self' 'sha256-" in value


@pytest.mark.parametrize(
    ("setting", "meta", "header"),
    [
        (False, False, None),
        ("report-only", False, "Content-Security-Policy-Report-Only"),
        ({"report-only": True}, False, "Content-Security-Policy-Report-Only"),
        (True, True, "Content-Security-Policy"),
    ],
)
def test_setting(tmp_path, setting, meta, header):
    out = _build(tmp_path, site={"csp": setting})
    assert bool(META.search((out / "docs/index.html").read_text(encoding="utf-8"))) is meta
    names = [n for n, _ in csp.site_headers(out)]
    assert names == ([header.lower().encode()] if header else [])


def test_extra_sources_add_and_none_replaces(tmp_path):
    out = _build(tmp_path, site={"csp": {"connect-src": "https://api.acme.dev", "frame-ancestors": ["'none'"],
                                         "img-src": ["'self'"]}})
    policy = _policy(csp.site_headers(out)[0][1].decode())
    assert policy["connect-src"] == ["'self'", "https://api.acme.dev"]
    assert policy["frame-ancestors"] == ["'none'"]
    assert policy["img-src"] == ["'self'", "data:", "blob:", "https:"]


def test_a_tag_manager_reports_only_unless_asked(tmp_path):
    gtm = {"gtm": {"tagId": "GTM-ABC123"}}
    out = _build(tmp_path, integrations=gtm)
    assert csp.site_headers(out)[0][0] == b"content-security-policy-report-only"
    out = _build(tmp_path, integrations=gtm, site={"csp": True})
    assert csp.site_headers(out)[0][0] == b"content-security-policy"


@pytest.mark.parametrize("bad", [{"script-src": "x; frame-ancestors *"}, {"connect-src": ["a\nb"]},
                                 {"Script Src": "x"}, {"report-only": "yes"}])
def test_header_injection_is_a_config_error(bad):
    with pytest.raises(ValidationError):
        Config.model_validate({"site": {"title": "C", "csp": bad}})


def test_a_build_without_docs_has_no_policy(tmp_path):
    out = tmp_path / "site"
    assert Compiler(Config.model_validate({"site": {"title": "C"}}), base_path=tmp_path).compile(out).success
    assert not (out / "_headers").exists() and not META.search((out / "index.html").read_text(encoding="utf-8"))
