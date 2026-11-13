"""Streamdown markdown vs the vanilla DOM plugins, in a real browser (dev-only).

The docs, chat, agents and playground styles still load the vanilla plugins
from ``templates/frontend/plugins``. ``syntax-highlight.js`` re-runs
highlight.js over every ``pre code`` after load and on each light/dark flip;
highlight.js rebuilds the block from its text, which collapses Shiki's
per-line spans into one line. ``code-copy.js`` wraps every ``pre`` when content
is announced. This test serves the current frontend build with those plugins
and checks that Streamdown's code blocks survive them, in a built docs site
(across SPA navigation) and in the chat style; chat also checks that steps
split by code fences are numbered 1, 2, 3, and that the floating copy bar
never covers the first code line.

Opt-in:  RUN_BROWSER_TESTS=1 pytest tests/browser/test_markdown_legacy_plugins_browser.py -o addopts=""

* Needs ``cd src/frontend && npm run build`` first (the test serves ``dist/``).
* Needs the ``playwright`` package and Chromium, and network access to
  cdnjs.cloudflare.com (``syntax-highlight.js`` loads highlight.js from it);
  without highlight.js there is nothing to guard against and the test skips.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import textwrap
import threading
import time
import urllib.request
from pathlib import Path

import pytest

if os.environ.get("RUN_BROWSER_TESTS") != "1":
    pytest.skip("browser tests are opt-in (RUN_BROWSER_TESTS=1)", allow_module_level=True)

sync_api = pytest.importorskip("playwright.sync_api")

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "src" / "frontend" / "dist"
PACKAGED = ROOT / "src" / "praisonaiui" / "templates" / "frontend"

PY_FENCE = 'import os\n\n\ndef main():\n    print(os.getcwd())\n\n\nmain()'
SH_FENCE = "pip install praisonaiui\naiui --version"

# Per code block: Shiki line spans, highlight.js leftovers, legacy copy wrappers, flat <pre>.
PROBE = """(sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const pres = [...root.querySelectorAll('[data-streamdown=code-block-body] > pre')];
  return {
    lines: pres.map(p => p.querySelectorAll(':scope > code > span.block').length),
    shiki: root.querySelectorAll('[data-streamdown=code-block-body] [style*="--shiki-dark"]').length,
    hljs: root.querySelectorAll('code.hljs, code[data-highlighted]').length,
    legacy: root.querySelectorAll('.aiui-code-wrapper, .aiui-copy-btn, [data-aiui-plugin], .mermaid-diagram').length,
    boxed: pres.filter(p => { const s = getComputedStyle(p);
      return s.paddingTop !== '0px' || s.borderTopWidth !== '0px' || s.backgroundColor !== 'rgba(0, 0, 0, 0)'; }).length,
    olStarts: [...root.querySelectorAll('ol')].map(o => o.getAttribute('start')),
    // the floating copy/download bar must not cover the first code line
    covered: [...root.querySelectorAll('[data-streamdown=code-block]')].filter(cb => {
      const bar = cb.querySelector('[data-streamdown=code-block-actions]'), line = cb.querySelector('code > span.block');
      return bar && line && bar.getBoundingClientRect().bottom > line.getBoundingClientRect().top + 1; }).length,
  };
}"""

# A plain block outside React: proves the legacy plugins really ran.
CONTROL = """() => {
  const pre = document.createElement('pre');
  pre.id = 'aiui-legacy-control';
  pre.innerHTML = '<code class="language-python">x = 1\\ny = 2</code>';
  document.body.appendChild(pre);
}"""


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_http(url: str, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError(f"server did not start: {url}")


@pytest.fixture(scope="module")
def built_frontend() -> Path:
    if not (DIST / "assets" / "index.js").is_file():
        pytest.skip("no frontend build: run `npm run build` in src/frontend")
    return DIST


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as exc:  # no browser available
            pytest.skip(f"no Chromium available: {exc}")
        yield b
        b.close()


def _templates_with_build(dest: Path, dist: Path) -> Path:
    """The packaged templates (plugins, chat.css, …) with the current build on top."""
    shutil.copytree(PACKAGED, dest)
    shutil.rmtree(dest / "assets", ignore_errors=True)
    shutil.copytree(dist / "assets", dest / "assets")
    for name in ("index.html", "aiui-manifest.json", "aiui-externals.json"):
        if (dist / name).is_file():
            shutil.copy(dist / name, dest / name)
    return dest


def _settle_legacy_plugins(page) -> None:
    """Wait for highlight.js (CDN) and the plugin's 200 ms first pass."""
    try:
        page.wait_for_function("() => typeof window.hljs !== 'undefined'", timeout=15000)
    except Exception:
        pytest.skip("highlight.js did not load from the CDN; the legacy plugin is inactive")
    page.wait_for_timeout(800)


def _flip_theme_twice(page) -> None:
    for _ in range(2):
        page.evaluate("document.documentElement.classList.toggle('dark')")
        page.wait_for_timeout(600)


def _assert_intact(result: dict, expected_lines: list[int], where: str) -> None:
    assert result is not None, f"{where}: markdown root not found"
    assert result["lines"] == expected_lines, f"{where}: Shiki line spans {result}"
    assert result["shiki"] > 0, f"{where}: no Shiki tokens {result}"
    assert result["hljs"] == 0, f"{where}: highlight.js rewrote a Streamdown block {result}"
    assert result["legacy"] == 0, f"{where}: legacy plugin DOM inside React content {result}"
    assert result["boxed"] == 0, f"{where}: a legacy pre style boxes the code again {result}"
    assert result["covered"] == 0, f"{where}: the code actions cover the first line {result}"


# ── built docs site ──


@pytest.fixture(scope="module")
def docs_site(built_frontend, tmp_path_factory):
    from typer.testing import CliRunner

    from praisonaiui.cli import app

    project = tmp_path_factory.mktemp("docs-site")
    (project / "aiui.template.yaml").write_text(
        textwrap.dedent(
            """\
            schemaVersion: 1
            site:
              title: "Legacy plugin probe"
            content:
              docs:
                dir: "./docs"
                include:
                  - "**/*.md"
            components:
              sidebar_docs:
                type: DocsSidebar
                props:
                  source: docs-nav
            templates:
              docs:
                layout: ThreeColumnLayout
                slots:
                  left:
                    ref: sidebar_docs
                  main:
                    type: DocContent
            routes:
              - match: "/docs/**"
                template: docs
            """
        ),
        encoding="utf-8",
    )
    docs = project / "docs"
    docs.mkdir()
    (docs / "index.md").write_text("# Home\n\nSee [Code](code.md) and [More](more.md).\n", encoding="utf-8")
    (docs / "code.md").write_text(
        f"# Code\n\nIntro with `inline`.\n\n```python\n{PY_FENCE}\n```\n\n## Shell\n\n```bash\n{SH_FENCE}\n```\n",
        encoding="utf-8",
    )
    (docs / "more.md").write_text(f"# More\n\n```bash\n{SH_FENCE}\n```\n", encoding="utf-8")
    out = project / "site"
    result = CliRunner().invoke(app, ["build", "--config", str(project / "aiui.template.yaml"), "--output", str(out)])
    assert result.exit_code == 0, result.output
    shutil.rmtree(out / "assets")
    shutil.copytree(built_frontend / "assets", out / "assets")

    import uvicorn
    from starlette.applications import Starlette
    from starlette.responses import FileResponse, Response
    from starlette.routing import Route

    async def spa(request):  # same resolution as `aiui serve`
        target = (out / request.url.path.lstrip("/")).resolve()
        if out.resolve() not in target.parents and target != out.resolve():
            return Response(status_code=403)
        for candidate in (target, target / "index.html", target.with_suffix(".html")):
            if candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(out / "index.html")

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(Starlette(routes=[Route("/{p:path}", spa)]), port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    _wait_http(f"http://127.0.0.1:{port}/")
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_docs_code_blocks_survive_legacy_plugins(browser, docs_site, scheme):
    page = browser.new_page(viewport={"width": 1280, "height": 900}, color_scheme=scheme)
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{docs_site}/docs/code")
    page.wait_for_selector("#main-content article [data-streamdown=code-block] code span.block")
    _settle_legacy_plugins(page)
    page.evaluate(CONTROL)
    _flip_theme_twice(page)
    # the plugin was active: the plain block outside React got highlighted
    assert page.evaluate("() => !!document.querySelector('#aiui-legacy-control code.hljs')")
    expected = [PY_FENCE.count("\n") + 1, SH_FENCE.count("\n") + 1]
    _assert_intact(page.evaluate(PROBE, "#main-content article"), expected, f"{scheme} /docs/code")

    # SPA navigation re-announces content (aiui:content-loaded) to every plugin
    page.locator("a[href$='/docs/more'], [data-nav-path='/docs/more']").first.click()
    page.wait_for_url("**/docs/more")
    page.wait_for_selector("#main-content article [data-streamdown=code-block] code span.block")
    page.wait_for_timeout(1000)
    _flip_theme_twice(page)
    _assert_intact(page.evaluate(PROBE, "#main-content article"), [SH_FENCE.count("\n") + 1], f"{scheme} /docs/more")
    assert not errors, errors
    page.close()


# ── chat style ──

CHAT_SERVER = textwrap.dedent(
    '''
    import asyncio, sys
    import uvicorn
    from praisonaiui.datastore import JSONFileDataStore
    from praisonaiui.provider import BaseProvider, RunEvent, RunEventType
    from praisonaiui import server as srv

    REPLY = sys.argv[3]

    class Provider(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Probe")
            for i in range(0, len(REPLY), 9):
                yield RunEvent(type=RunEventType.RUN_CONTENT, token=REPLY[i:i + 9], agent_name="Probe")
                await asyncio.sleep(0.005)
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content=REPLY)

    srv.set_style("chat")
    srv.set_datastore(JSONFileDataStore(sys.argv[2]))  # never the user's session store
    srv.set_provider(Provider())
    uvicorn.run(srv.create_app(), host="127.0.0.1", port=int(sys.argv[1]), log_level="warning")
    '''
)

CHAT_REPLY = (
    "Steps:\n\n1. Install\n\n```bash\n" + SH_FENCE + "\n```\n\n1. Run\n\n```python\n" + PY_FENCE + "\n```\n\n1. Done\n"
)


@pytest.fixture(scope="module")
def chat_server(built_frontend, tmp_path_factory):
    work = tmp_path_factory.mktemp("chat-style")
    templates = _templates_with_build(work / "templates", built_frontend)
    script = work / "serve_chat.py"
    script.write_text(CHAT_SERVER, encoding="utf-8")
    port = _free_port()
    # No provider keys: the mock provider needs none, and chat memory must not call out.
    env = {k: v for k, v in os.environ.items() if not k.endswith(("_API_KEY", "_TOKEN"))}
    env.update({
        "PYTHONPATH": str(ROOT / "src"),
        "AIUI_TEMPLATES_DIR": str(templates),
        "AIUI_DATA_DIR": str(work / "data"),
        "AIUI_DISABLE_PLUGIN_AUTOLOAD": "1",
        "HOME": str(work / "home"),
    })
    (work / "home").mkdir()
    sessions = work / "sessions"
    proc = subprocess.Popen([sys.executable, str(script), str(port), str(sessions), CHAT_REPLY], env=env, cwd=work)
    try:
        _wait_http(f"http://127.0.0.1:{port}/", timeout=60)
        yield f"http://127.0.0.1:{port}"
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def _get_json(url: str, attempts: int = 3) -> dict:
    """GET JSON from the chat server, which answers slowly while a run is in flight.

    A turn makes the server do memory and embedding work on the same loop, so a
    short timeout fails the test for a reason that has nothing to do with markdown.
    """
    last: Exception | None = None
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except (TimeoutError, OSError) as exc:
            last = exc
            time.sleep(1)
    raise AssertionError(f"chat server did not answer {url}: {last!r}")


def _runs(base: str) -> list:
    runs = []
    for s in _get_json(f"{base}/sessions").get("sessions", []):
        runs += _get_json(f"{base}/sessions/{s['id']}/runs").get("runs", [])
    return runs


def test_chat_code_blocks_survive_legacy_plugins(browser, chat_server):
    page = browser.new_page(viewport={"width": 1100, "height": 1000}, color_scheme="light")
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(chat_server + "/")
    page.wait_for_selector("textarea")
    _settle_legacy_plugins(page)
    message = f"legacy probe {os.getpid()}"
    page.fill("textarea", message)
    page.keyboard.press("Enter")
    # reload once the whole reply is stored: history renders while the plugins load
    deadline = time.time() + 30
    while "1. Done" not in json.dumps(_runs(chat_server)) and time.time() < deadline:
        time.sleep(0.25)
    page.reload()
    page.wait_for_selector("textarea")
    page.get_by_text(message, exact=False).first.click()
    page.wait_for_function(
        "() => [...document.querySelectorAll('[data-aiui-markdown]')].some(m =>"
        " m.querySelectorAll('[data-streamdown=code-block]').length === 2 && m.textContent.includes('Done'))",
        timeout=20000,
    )
    _settle_legacy_plugins(page)
    page.evaluate(CONTROL)
    _flip_theme_twice(page)
    assert page.evaluate("() => !!document.querySelector('#aiui-legacy-control code.hljs')")

    # plugin-loader announcing content runs code-copy over the page; its teardown
    # strips data-copy-processed first, which the guard puts back
    page.evaluate(
        """() => {
          document.querySelectorAll('[data-aiui-markdown] pre').forEach(p => delete p.dataset.copyProcessed);
          window.dispatchEvent(new CustomEvent('aiui:content-loaded', {detail: {root: document.body}}));
        }"""
    )
    page.wait_for_timeout(800)
    assert page.evaluate("() => !!document.querySelector('#aiui-legacy-control .aiui-copy-btn')")

    result = page.evaluate(PROBE, "[data-aiui-markdown]:has([data-streamdown=code-block])")
    _assert_intact(result, [SH_FENCE.count("\n") + 1, PY_FENCE.count("\n") + 1], "chat")
    # lazily numbered steps split by fences: 1., 2., 3.
    assert result["olStarts"] == [None, "2", "3"], result
    assert not errors, errors
    page.close()
