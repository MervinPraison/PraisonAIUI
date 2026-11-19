"""``aiui dev``: build, serve, rebuild on save and reload the open tab."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import pytest
from starlette.testclient import TestClient
from typer.testing import CliRunner

from praisonaiui import dev_server
from praisonaiui.cli import app as cli_app
from praisonaiui.dev_server import EVENTS_PATH, DevSite, with_client

CONFIG = """site:
  title: Preview
content:
  docs:
    dir: docs
"""


@pytest.fixture
def project(tmp_path: Path) -> Path:
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "index.md").write_text("---\ntitle: Home\n---\n# Home\n\nfirst words\n")
    (tmp_path / "aiui.yaml").write_text(CONFIG)
    return tmp_path


@pytest.fixture
def site(project: Path):
    s = DevSite(project / "aiui.yaml", project, url_base="/")
    yield s
    s.close()


def _first_events(site: DevSite, n: int) -> list[str]:
    async def take():
        gen, out = site.events(poll=0.01), []
        async for chunk in gen:
            out.append(chunk)
            if len(out) == n:
                await gen.aclose()
                return out

    return asyncio.run(take())


def test_with_client_goes_before_body_end():
    html = with_client(b"<html><body><p>x</p></body></html>", "abc-1")
    assert html.endswith(b"</script></body></html>")
    assert b'data-build="abc-1" src="/__aiui/dev.js"' in html
    assert with_client(b"<p>no body</p>", "x").startswith(b"<p>no body</p><script")


def test_html_gets_the_reload_script_and_other_files_do_not(site):
    assert site.build(), site.error
    client = TestClient(site)
    page = client.get("/docs/index", headers={"Accept-Encoding": "gzip"})
    assert page.status_code == 200
    assert f'data-build="{site.build_id}"'.encode() in page.content
    assert page.headers["cache-control"] == "no-store"
    assert int(page.headers["content-length"]) == len(page.content)
    nav = client.get("/docs-nav.json")
    assert nav.status_code == 200 and b"data-aiui-dev" not in nav.content
    assert client.head("/docs/index").status_code == 200
    # A file, so the page's Content-Security-Policy (script-src 'self') lets it run
    script = client.get("/__aiui/dev.js")
    assert script.headers["content-type"].startswith("text/javascript")
    assert EVENTS_PATH.encode() in script.content and b"data-build" in script.content
    assert "script-src 'self'" in page.headers["content-security-policy"]


def test_build_output_never_carries_the_script(site, project):
    assert site.build()
    for path in list(site.root.rglob("*.html")) + list(site.root.rglob("*.json")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        assert "data-aiui-dev" not in text and EVENTS_PATH not in text, path
    result = CliRunner().invoke(
        cli_app, ["build", "-c", str(project / "aiui.yaml"), "-o", str(project / "out")]
    )
    assert result.exit_code == 0, result.output
    assert all("data-aiui-dev" not in p.read_text() for p in (project / "out").rglob("*.html"))


def test_a_broken_edit_keeps_the_last_good_build(site, project):
    assert site.build()
    good_id, client = site.build_id, TestClient(site)

    (project / "aiui.yaml").write_text("site:\n  title: [unclosed\n")
    assert not site.build()
    assert "aiui.yaml" in site.error and site.build_id == good_id
    page = client.get("/docs/index.md")
    assert page.status_code == 200 and "first words" in page.text
    assert json.loads(_first_events(site, 2)[1].removeprefix("data: "))["error"] == site.error

    (project / "aiui.yaml").write_text(CONFIG)
    (project / "docs" / "index.md").write_text("# Home\n\nsecond words\n")
    assert site.build()
    assert site.error == "" and site.build_id != good_id
    assert "second words" in client.get("/docs/index.md").text
    assert len(list(site.workdir.glob("build-*"))) <= 2  # old builds are removed


def test_schema_errors_are_reported(site, project):
    (project / "aiui.yaml").write_text("site:\n  title: 5\n")
    assert not site.build()
    assert "site.title" in site.error


def test_waiting_page_until_the_first_good_build(site, project):
    (project / "aiui.yaml").write_text("site: [\n")
    assert not site.build()
    page = TestClient(site).get("/")
    assert page.status_code == 503 and b"data-aiui-dev" in page.content


def test_events_send_the_build_and_the_change(site):
    assert site.build()
    first = _first_events(site, 2)
    assert first[0].startswith("retry:")
    assert json.loads(first[1].removeprefix("data: ")) == {"id": site.build_id, "error": ""}


def test_events_end_on_shutdown(site):
    site.stop.set()

    async def drain():
        return [chunk async for chunk in site.events(poll=0.01)]

    assert asyncio.run(drain()) == ["retry: 1000\n\n"]  # Ctrl+C is not held up by open tabs


def test_unknown_host_is_refused_on_loopback(site):
    sent: list = []

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": "GET",
        "path": EVENTS_PATH,
        "query_string": b"",
        "scheme": "http",
        "server": ("127.0.0.1", 8000),
        "headers": [(b"host", b"rebind.example")],
    }
    asyncio.run(site(scope, receive, send))
    assert sent[0]["status"] == 400


def test_saving_a_page_rebuilds(site, project):
    import threading

    assert site.build()
    first = site.build_id
    builds: list[bool] = []
    thread = threading.Thread(
        target=site.watch, args=(lambda ok, took: builds.append(ok),), daemon=True
    )
    thread.start()
    try:
        deadline = time.monotonic() + 15
        while site.build_id == first and time.monotonic() < deadline:
            (project / "docs" / "index.md").write_text(f"# Home\n\nsaved {time.monotonic()}\n")
            time.sleep(0.5)
        assert site.build_id != first and builds and all(builds)
    finally:
        site.stop.set()
        thread.join(5)


def test_git_dates_are_looked_up_once_per_session(project, monkeypatch):
    from praisonaiui.compiler import Compiler, page_meta
    from praisonaiui.schema.models import Config

    calls: list[Path] = []
    monkeypatch.setattr(page_meta, "git_last_updated", lambda p: calls.append(p) or "2026-01-02")
    cfg = Config.model_validate(
        {"site": {"title": "x"}, "content": {"docs": {"dir": "docs", "lastUpdated": True}}}
    )
    dates: dict = {}
    for n in range(2):
        compiler = Compiler(cfg, base_path=project)
        compiler.git_dates = dates
        assert compiler.compile(output_dir=project / f"o{n}").success
    assert len(calls) == 1
    assert "2026-01-02" in (project / "o1" / "docs-nav.json").read_text()


# -- the command ------------------------------------------------------------


@pytest.fixture
def ran(monkeypatch):
    calls: list = []
    monkeypatch.setattr(dev_server, "run", lambda *a, **k: calls.append((a, k)))
    monkeypatch.setattr(
        "praisonaiui.cli._examples_dashboard", lambda *a: calls.append(("examples", a))
    )
    return calls


def test_dev_previews_the_site_in_this_folder(project, ran, monkeypatch):
    monkeypatch.chdir(project)
    result = CliRunner().invoke(cli_app, ["dev", "--no-open", "--port", "8123"])
    assert result.exit_code == 0, result.output
    (config, folder), options = ran[0]
    assert config == Path("aiui.yaml") and folder == Path(".")
    assert options["port"] == 8123 and options["open_browser"] is False


def test_dev_needs_only_a_docs_folder(tmp_path, ran, monkeypatch):
    (tmp_path / "docs").mkdir()
    monkeypatch.chdir(tmp_path)
    assert CliRunner().invoke(cli_app, ["dev"]).exit_code == 0
    (config, _folder), options = ran[0]
    assert config is None and options["port"] == 8000 and options["open_browser"] is True


def test_dev_examples_dashboard_stays_available(project, ran, monkeypatch):
    monkeypatch.chdir(project)
    assert CliRunner().invoke(cli_app, ["dev", "--examples", "ex"]).exit_code == 0
    assert ran == [("examples", (Path("ex"), 9000, "127.0.0.1"))]


def test_dev_in_an_empty_folder_says_what_to_do(tmp_path, ran, monkeypatch):
    monkeypatch.chdir(tmp_path)
    result = CliRunner().invoke(cli_app, ["dev"])
    assert result.exit_code == 2 and "aiui init" in result.output and not ran
