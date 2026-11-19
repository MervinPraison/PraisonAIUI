"""Analytics, support chat widgets and cookie consent in a docs build (``integrations:``)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from praisonaiui.compiler import Compiler
from praisonaiui.compiler import integrations as ig
from praisonaiui.schema.models import Config


def _config(tmp_path: Path, integrations: dict, **extra) -> Config:
    docs = tmp_path / "docs"
    docs.mkdir(exist_ok=True)
    (docs / "index.md").write_text("# Home\n\nWelcome.\n", encoding="utf-8")
    (docs / "guide.md").write_text("# Guide\n\nSteps.\n", encoding="utf-8")
    return Config.model_validate({"site": {"title": "Acme", **extra}, "content": {"docs": {"dir": "docs"}},
                                  "integrations": integrations})


def _build(tmp_path: Path, integrations: dict, dev: bool = False, **extra) -> tuple[Path, Compiler]:
    compiler = Compiler(_config(tmp_path, integrations, **extra), base_path=tmp_path)
    compiler.dev = dev
    out = tmp_path / "out"
    result = compiler.compile(out)
    assert result.success, result.error
    return out, compiler


def _settings(page: str) -> dict:
    return json.loads(re.search(r'<script type="application/json" id="aiui-integrations-config">(.*?)</script>',
                                page).group(1))


def test_providers_reach_every_page_as_data_and_one_loader_file(tmp_path):
    out, compiler = _build(tmp_path, {
        "ga4": "G-ABC1234", "plausible": {"domain": "docs.acme.dev"}, "segment": "abcDEF123456",
        "intercom": {"appId": "abc12345"}, "consent": True})
    for name in ("index.html", "404.html", "docs/guide.html"):
        head = (out / name).read_text(encoding="utf-8").split("</head>", 1)[0]
        data = _settings(head)
        assert re.search(r'<script async src="/aiui-integrations\.js\?v=[0-9a-f]{10}"></script>', head)
    assert data["providers"]["ga4"] == {
        "src": "https://www.googletagmanager.com/gtag/js?id=G-ABC1234", "id": "G-ABC1234"}
    assert data["providers"]["plausible"]["src"] == "https://plausible.io/js/script.js"
    assert data["support"] == ["intercom"]
    assert data["consent"]["accept"] == "Accept" and data["respectDoNotTrack"] is True
    # No inline executable script: the loader is a file, the settings a JSON data block.
    assert (out / ig.SCRIPT).read_text(encoding="utf-8") == ig.loader()
    css = (out / "assets" / "theme.css").read_text(encoding="utf-8")
    assert ".aiui-consent {" in css and "var(--card)" in css and not re.search(r"#[0-9a-fA-F]{3,6}\b", ig.BANNER_CSS)
    origins = compiler.external_origins()
    assert {"https://*.googletagmanager.com", "https://widget.intercom.io"} <= set(origins["script-src"])
    assert {"https://plausible.io", "https://api.segment.io"} <= set(origins["connect-src"])


def test_settings_text_is_escaped_for_inline_json(tmp_path):
    out, _ = _build(tmp_path, {"fathom": "ABCDEFG", "consent": {
        "text": "We count visits </script><script>alert(1)</script> & that's it", "policy": "/privacy"}},
        base_path="/handbook")
    page = (out / "index.html").read_text(encoding="utf-8")
    assert "<script>alert(1)" not in page
    assert _settings(page)["consent"]["text"].startswith("We count visits </script>")
    assert _settings(page)["consent"]["policy"] == "/handbook/privacy"
    assert 'src="/handbook/aiui-integrations.js?v=' in page


@pytest.mark.parametrize("integrations", [
    {"ga4": 'G-ABC"><script>'}, {"posthog": {"apiKey": "phc_abcdefghijk", "apiHost": "javascript:x"}},
    {"umami": "not-a-uuid"}, {"scripts": ["http://plain.example.com/x.js"]}, {"consent": {"policy": "javascript:x"}},
])
def test_ids_and_urls_are_checked(tmp_path, integrations):
    with pytest.raises(ValidationError):
        _config(tmp_path, integrations)


def test_off_in_dev_unless_asked_and_absent_without_providers(tmp_path):
    out, compiler = _build(tmp_path, {"ga4": "G-ABC1234"}, dev=True)
    assert "aiui-integrations" not in (out / "index.html").read_text(encoding="utf-8")
    assert not (out / ig.SCRIPT).exists() and compiler.external_origins() == {}
    out, _ = _build(tmp_path, {"ga4": "G-ABC1234", "dev": True}, dev=True)
    assert "aiui-integrations" in (out / "index.html").read_text(encoding="utf-8")
    out, _ = _build(tmp_path, {"consent": True})  # nothing to load: nothing added
    assert "aiui-integrations" not in (out / "index.html").read_text(encoding="utf-8")


def test_every_provider_has_a_runner_in_the_loader():
    js = ig.loader()
    for name in [*ig.PROVIDERS, "scripts"]:
        assert re.search(rf"\n    {name}: function", js), name


# ── The loader itself, run by node against a tiny fake DOM ─────────────────

_HARNESS = r"""
const [src, settings, setup] = [process.argv[1], JSON.parse(process.argv[2]), JSON.parse(process.argv[3])];
const loaded = [], on = {}, store = Object.assign({}, setup.store);
const node = (tag) => ({ tag, children: [], listeners: {}, setAttribute() {},
  appendChild(c) { this.children.push(c); if (c.tag === 'script') loaded.push(c.src); return c; },
  remove() { body.children = body.children.filter((x) => x !== this); },
  addEventListener(t, f) { this.listeners[t] = f; } });
const body = node('body');
const ctx = { console, JSON, Date, setTimeout: (f) => f(), clearTimeout() {}, requestIdleCallback: (f) => f(),
  location: { pathname: '/docs/a', search: '', reload() { ctx.reloaded = true; } },
  navigator: setup.navigator || {},
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
  addEventListener(t, f) { (on[t] = on[t] || []).push(f); },
  document: { head: node('head'), body, title: 'A', createElement: node, createTextNode: node,
    getElementById: () => ({ textContent: JSON.stringify(settings) }), addEventListener() {} } };
ctx.window = ctx;
require('vm').runInNewContext(src, ctx);
const fire = (t, detail) => (on[t] || []).forEach((f) => f({ detail }));
const banner = () => body.children.find((c) => c.className === 'aiui-consent');
for (const [kind, a, b] of setup.steps || []) {
  if (kind === 'click') banner().children[1].children.find((x) => x.textContent === a).listeners.click();
  if (kind === 'go') { ctx.location.pathname = a; fire('aiui:content-loaded', {}); }
  if (kind === 'event') fire(a, b);
}
console.log(JSON.stringify({ loaded, store, banner: banner() ? banner().children[0].textContent : null,
  segmentPages: (ctx.analytics || []).filter((e) => e[0] === 'page').length,
  intercom: ctx.Intercom ? ctx.Intercom.q.map((a) => a[0]) : [], reloaded: !!ctx.reloaded }));
"""


def _run(tmp_path: Path, integrations: dict, **setup) -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    found = ig.collect(_config(tmp_path, integrations).integrations)
    page = f"<head>{found.head}</head>"
    result = subprocess.run([node, "-e", _HARNESS, found.script, json.dumps(_settings(page)), json.dumps(setup)],
                            capture_output=True, text=True, timeout=30, check=True)
    return json.loads(result.stdout)


_PROVIDERS = {"segment": "abcDEF123456", "plausible": "docs.acme.dev", "intercom": "abc12345"}


def test_loader_loads_at_once_without_consent_and_counts_client_navigations(tmp_path):
    out = _run(tmp_path, _PROVIDERS, steps=[["go", "/docs/b"], ["go", "/docs/b"], ["go", "/docs/c"]])
    assert out["loaded"] == [
        "https://plausible.io/js/script.js",
        "https://cdn.segment.com/analytics.js/v1/abcDEF123456/analytics.min.js",
        "https://widget.intercom.io/widget/abc12345",
    ]
    assert out["segmentPages"] == 3  # the first page, then /docs/b and /docs/c once each
    assert out["intercom"] == ["boot", "update", "update"]
    assert out["banner"] is None


def test_loader_waits_for_accept_and_remembers_it(tmp_path):
    asked = _run(tmp_path, {**_PROVIDERS, "consent": {"text": "Cookies?"}})
    assert asked["loaded"] == [] and asked["banner"] == "Cookies?"
    accepted = _run(tmp_path, {**_PROVIDERS, "consent": True}, steps=[["click", "Accept"]])
    assert len(accepted["loaded"]) == 3 and accepted["store"] == {"aiui-consent": "granted"}
    assert accepted["banner"] is None
    again = _run(tmp_path, {**_PROVIDERS, "consent": True}, store={"aiui-consent": "granted"})
    assert len(again["loaded"]) == 3 and again["banner"] is None


def test_loader_decline_loads_nothing_and_stops_what_runs(tmp_path):
    declined = _run(tmp_path, {**_PROVIDERS, "consent": True}, steps=[["click", "Decline"]])
    assert declined["loaded"] == [] and declined["store"] == {"aiui-consent": "denied"}
    assert declined["banner"] is None and not declined["reloaded"]
    remembered = _run(tmp_path, {**_PROVIDERS, "consent": True}, store={"aiui-consent": "denied"})
    assert remembered["loaded"] == [] and remembered["banner"] is None
    withdrawn = _run(tmp_path, {**_PROVIDERS, "consent": True}, store={"aiui-consent": "granted"},
                     steps=[["event", "aiui:consent", {"granted": False}]])
    assert withdrawn["reloaded"] and withdrawn["store"] == {"aiui-consent": "denied"}


def test_loader_follows_an_outside_consent_tool(tmp_path):
    out = _run(tmp_path, {**_PROVIDERS, "consent": {"banner": False}},
               steps=[["event", "aiui:consent", {"granted": True}]])
    assert out["banner"] is None and len(out["loaded"]) == 3


@pytest.mark.parametrize("navigator", [{"globalPrivacyControl": True}, {"doNotTrack": "1"}])
def test_loader_skips_analytics_for_opted_out_readers_but_keeps_support_chat(tmp_path, navigator):
    out = _run(tmp_path, _PROVIDERS, navigator=navigator)
    assert out["loaded"] == ["https://widget.intercom.io/widget/abc12345"]
    out = _run(tmp_path, {**_PROVIDERS, "respectDoNotTrack": False}, navigator=navigator)
    assert len(out["loaded"]) == 3


def test_a_cookie_settings_link_is_not_a_broken_anchor(tmp_path):
    from praisonaiui.compiler.links import check_links

    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "index.md").write_text("# Home\n\n[Cookie settings](#cookie-settings) [Gone](#nowhere)\n")
    report = check_links(docs, root=tmp_path)
    assert [b.target for b in report.broken] == ["#nowhere"]
