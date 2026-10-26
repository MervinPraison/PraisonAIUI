"""Browser smoke + axe accessibility check for the Replay view (dev-only, never shipped).

Opt-in:  RUN_BROWSER_TESTS=1 AXE_CORE_JS=/path/to/axe.min.js pytest tests/browser -o addopts=""

* Needs the ``playwright`` Python package and a Chrome install (``channel="chrome"``)
  or a Playwright Chromium (``python -m playwright install chromium``).
* axe-core (MPL-2.0) is loaded from ``AXE_CORE_JS`` (e.g. ``npm i axe-core`` in
  any scratch dir); the axe checks are skipped when it is not provided.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import threading
import time
from pathlib import Path

import pytest

if os.environ.get("RUN_BROWSER_TESTS") != "1":
    pytest.skip("browser tests are opt-in (RUN_BROWSER_TESTS=1)", allow_module_level=True)

sync_api = pytest.importorskip("playwright.sync_api")

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures" / "replay"
AXE = os.environ.get("AXE_CORE_JS")
WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]


def _events(name: str) -> list[dict]:
    return [json.loads(line) for line in (FIXTURES / f"{name}.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch(channel="chrome")
        except Exception:
            try:
                b = p.chromium.launch()
            except Exception as exc:  # no browser available
                pytest.skip(f"no Chromium/Chrome available: {exc}")
        yield b
        b.close()


def _page(browser, scheme: str = "light", reduced: bool = False):
    page = browser.new_page(
        viewport={"width": 1366, "height": 1000},
        color_scheme=scheme,
        reduced_motion="reduce" if reduced else "no-preference",
    )
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    return page, errors


def _axe(page, selector: str = ".rp-root") -> list[dict]:
    if not AXE:
        return []
    page.add_script_tag(path=AXE)
    result = page.evaluate(
        """async ([sel, tags]) => {
            const r = await axe.run(document.querySelector(sel), {runOnly: {type: 'tag', values: tags}});
            return r.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' '))}));
        }""",
        [selector, WCAG_TAGS],
    )
    return result


def _standalone(tmp_path: Path, name: str) -> str:
    from praisonaiui.features.replay import standalone_html

    out = tmp_path / f"{name}.html"
    out.write_text(standalone_html(_events(name), title=name), encoding="utf-8")
    return out.as_uri()


def _current_index(page) -> int:
    return int(page.get_attribute('.rp-step[aria-current="step"]', "data-i"))


@pytest.mark.parametrize("name", ["team_handoff", "flow_parallel_loop", "legacy_v10", "team_outside"])
def test_standalone_steps_with_arrow_keys(browser, tmp_path, name):
    page, errors = _page(browser)
    page.goto(_standalone(tmp_path, name))
    page.wait_for_selector(".rp-step")
    total = page.locator(".rp-step").count()
    assert total > 5
    assert _current_index(page) == total - 1  # opens at the end (whole run visible)

    page.locator(".rp-step").nth(total - 1).focus()
    page.keyboard.press("Home")
    assert _current_index(page) == 0
    for _ in range(3):
        page.keyboard.press("ArrowRight")
    assert _current_index(page) == 3
    page.keyboard.press("ArrowLeft")
    assert _current_index(page) == 2
    # focus follows the cursor in the step list, the scrubber and the drawer agree
    assert page.evaluate("document.activeElement.getAttribute('data-i')") == "2"
    assert page.input_value("#rp-scrub-range") == "2"
    step_text = page.locator('.rp-step[aria-current="step"] .rp-step-text').inner_text()
    assert page.locator(".rp-drawer h3").inner_text() == step_text
    # replay: later blocks are drawn as "not reached yet"
    assert page.locator(".rp-block.rp-future").count() > 0
    page.keyboard.press("End")
    assert _current_index(page) == total - 1
    assert page.locator(".rp-block.rp-future").count() == 0
    assert not errors, errors


def test_standalone_drawer_tabs_map_and_axe(browser, tmp_path):
    page, errors = _page(browser)
    page.goto(_standalone(tmp_path, "team_handoff"))
    page.wait_for_selector(".rp-step")
    # select the hand-off step and read the Why tab
    page.locator(".rp-step", has_text="handed off to Writer").click()
    page.locator('[role="tab"]', has_text="Why").click()
    why = page.locator("#rp-tabpanel").inner_text()
    assert "Hand-off reason" in why and "Facts gathered" in why
    # keyboard on the tablist moves between tabs
    page.keyboard.press("ArrowRight")
    assert page.get_attribute('[role="tab"][aria-selected="true"]', "id") == "rp-tab-raw"
    assert '"event_type": "agent_handoff"' in page.locator("#rp-tabpanel pre").inner_text()
    # manager's task snapshot shows up for the delegated task
    page.locator(".rp-step", has_text="Task 'research' went to Researcher").click()
    page.locator('[role="tab"]', has_text="Why").click()
    assert "Manager's task snapshot" in page.locator("#rp-tabpanel").inner_text()
    # approval evidence
    page.locator(".rp-step", has_text="You approved write_file").click()
    assert "Decided by" in page.locator("#rp-tabpanel").inner_text()

    violations = _axe(page)
    assert violations == [], json.dumps(violations, indent=2)

    page.click("[data-key='overlay']")
    page.click("[data-key='view:map']")
    page.wait_for_selector(".rp-node")
    assert page.locator(".rp-node").count() == 10
    labels = page.eval_on_selector_all(".rp-edge text", "els => els.map(e => e.textContent)")
    assert "hands off" in labels and any(t.startswith("delegates") for t in labels)
    page.locator(".rp-node").first.focus()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    assert page.locator(".rp-drawer h3").inner_text()
    violations = _axe(page)
    assert violations == [], json.dumps(violations, indent=2)

    page.select_option("[data-key='theme']", "dark")
    assert page.get_attribute(".rp-root", "data-theme") == "dark"
    violations = _axe(page)
    assert violations == [], json.dumps(violations, indent=2)
    page.click("[data-key='view:timeline']")
    violations = _axe(page)
    assert violations == [], json.dumps(violations, indent=2)
    assert not errors, errors


def test_reduced_motion_has_no_animation(browser, tmp_path):
    page, _ = _page(browser, reduced=True)
    page.goto(_standalone(tmp_path, "flow_parallel_loop"))
    page.wait_for_selector(".rp-step")
    names = page.evaluate(
        "[...document.querySelectorAll('.rp-root *')].map(e => getComputedStyle(e).animationName).filter(n => n && n !== 'none')"
    )
    assert names == []


def _boxes(page, selector: str) -> list[dict]:
    return page.eval_on_selector_all(
        selector,
        "els => els.map(e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, id: e.closest('[data-block]')?.getAttribute('data-block')}; })",
    )


@pytest.mark.parametrize("name", ["team_outside", "team_handoff", "flow_parallel_loop"])
def test_timeline_blocks_never_overlap(browser, tmp_path, name):
    """An LLM span encloses its tool calls in real runs; tools go on their own row."""
    page, errors = _page(browser)
    page.goto(_standalone(tmp_path, name))
    page.wait_for_selector(".rp-block")
    boxes = _boxes(page, ".rp-block .rp-body")
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            apart = a["x"] + a["w"] <= b["x"] + 0.5 or b["x"] + b["w"] <= a["x"] + 0.5 or a["y"] + a["h"] <= b["y"] + 0.5 or b["y"] + b["h"] <= a["y"] + 0.5
            assert apart, f"{a['id']} overlaps {b['id']}"
    # a label that does not fit is ellipsized, and the full text is in the title and name
    llm = page.locator(".rp-block.rp-k-llm").first
    name_attr = llm.get_attribute("aria-label")
    title = llm.locator("title").text_content()
    assert name_attr.startswith(title)
    llm.focus()
    assert page.locator(".rp-tip").get_attribute("visibility") == "visible"
    assert page.locator(".rp-tip text").text_content() == title
    assert not errors, errors


def test_why_tab_by_role_and_keyboard(browser, tmp_path):
    page, errors = _page(browser)
    page.goto(_standalone(tmp_path, "team_outside"))
    page.wait_for_selector(".rp-step")
    page.locator(".rp-step", has_text="Triage handed off to Billing").click()
    page.get_by_role("tab", name="Why").click()
    assert page.get_by_role("tab", name="Why").get_attribute("aria-selected") == "true"
    why = page.get_by_role("tabpanel").inner_text()
    assert "Hand-off reason" in why and "Billing question" in why and "Context passed" in why
    # the task input
    page.locator(".rp-step", has_text="Task 'research' went to Researcher").click()
    assert "Task description" in page.get_by_role("tabpanel").inner_text()
    assert "Get one fact about electric vehicles" in page.get_by_role("tabpanel").inner_text()
    # keyboard: focus the selected tab, arrow keys move between tabs
    page.get_by_role("tab", name="Why").focus()
    page.keyboard.press("ArrowLeft")
    assert page.get_by_role("tab", name="What happened").get_attribute("aria-selected") == "true"
    page.keyboard.press("ArrowRight")
    assert page.get_by_role("tab", name="Why").get_attribute("aria-selected") == "true"
    assert page.evaluate("document.activeElement.getAttribute('role')") == "tab"
    # route chosen and approval decision
    page.goto(_standalone(tmp_path, "flow_parallel_loop"))
    page.wait_for_selector(".rp-step")
    page.locator(".rp-step", has_text="chose route 'publish'").click()
    page.get_by_role("tab", name="Why").click()
    assert "Route chosen" in page.get_by_role("tabpanel").inner_text()
    page.goto(_standalone(tmp_path, "team_handoff"))
    page.wait_for_selector(".rp-step")
    page.locator(".rp-step", has_text="You approved write_file").click()
    page.get_by_role("tab", name="Why").click()
    panel = page.get_by_role("tabpanel").inner_text()
    assert "Decision" in panel and "Approved with edited arguments" in panel
    assert not errors, errors


def test_theme_follows_system_with_override(browser, tmp_path):
    url = _standalone(tmp_path, "team_handoff")
    bg = "getComputedStyle(document.querySelector('.rp-root')).backgroundColor"
    page, _ = _page(browser, scheme="dark")
    page.goto(url)
    page.wait_for_selector(".rp-step")
    assert page.get_attribute(".rp-root", "data-theme") == "system"
    assert page.evaluate(bg) == "rgb(22, 23, 27)"
    page.select_option("[data-key='theme']", "light")
    assert page.evaluate(bg) == "rgb(255, 255, 255)"
    page.close()
    page, _ = _page(browser, scheme="light")
    page.goto(url)
    page.wait_for_selector(".rp-step")
    assert page.evaluate(bg) == "rgb(255, 255, 255)"


def test_map_fits_on_open_and_groups_outside_agents(browser, tmp_path):
    page, errors = _page(browser)
    page.goto(_standalone(tmp_path, "team_outside"))
    page.wait_for_selector(".rp-step")
    page.get_by_role("button", name="Map").click()
    page.wait_for_selector(".rp-node")
    box = page.evaluate("(() => { const c = document.querySelector('.rp-canvas'); const r = c.getBoundingClientRect(); return {l: r.left, r: r.right, sw: c.scrollWidth, cw: c.clientWidth}; })()")
    assert box["sw"] <= box["cw"] + 1, "map overflows on open"
    for n in _boxes(page, ".rp-node .rp-card"):
        assert box["l"] - 1 <= n["x"] and n["x"] + n["w"] <= box["r"] + 1
    assert "Outside the team" in page.locator(".rp-group text").text_content()
    outside = page.get_by_role("group", name="Outside the team")
    assert outside.locator(".rp-node").count() == 3
    labels = page.eval_on_selector_all(".rp-edge text", "els => els.map(e => e.textContent)")
    assert "hands off" in labels
    before = float(page.get_attribute(".rp-canvas svg", "width"))
    page.get_by_role("button", name="Zoom in").click()
    assert float(page.get_attribute(".rp-canvas svg", "width")) == pytest.approx(before * 1.5, abs=2)
    page.get_by_role("button", name="Fit").click()
    assert float(page.get_attribute(".rp-canvas svg", "width")) == pytest.approx(before, abs=2)
    assert not errors, errors


@pytest.mark.parametrize("name", ["team_outside", "flow_parallel_loop"])
def test_phone_width_has_no_page_scroll(browser, tmp_path, name):
    page, errors = _page(browser)
    page.set_viewport_size({"width": 400, "height": 860})
    page.goto(_standalone(tmp_path, name))
    page.wait_for_selector(".rp-step")
    assert page.evaluate("document.documentElement.scrollWidth") <= 400
    r = page.evaluate("(() => { const b = document.querySelector('.rp-root').getBoundingClientRect(); return [b.left, b.right]; })()")
    assert r[0] == pytest.approx(16, abs=1) and r[1] == pytest.approx(384, abs=1)
    page.get_by_role("button", name="Map").click()
    assert page.evaluate("document.documentElement.scrollWidth") <= 400
    assert not errors, errors


@pytest.mark.parametrize("order", ["core-first", "view-first"])
def test_wrapper_style_export_boots(browser, tmp_path, order):
    """The wrapper inlines both files as module scripts into #replay-root (which holds
    a fallback table) after window.__REPLAY_DATA__; the view must replace it."""
    views = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "views"
    core = (views / "replay-core.js").read_text(encoding="utf-8").replace("</", "<\\/")
    view = (views / "replay.js").read_text(encoding="utf-8").replace("</", "<\\/")
    scripts = [core, view] if order == "core-first" else [view, core]
    data = json.dumps({"run_id": "team-outside-01", "events": _events("team_outside"), "graph": None}).replace("<", "\\u003c")
    html = (
        "<!doctype html><html lang=en><head><meta charset=utf-8><title>PraisonAI Replay: x</title></head><body>"
        "<div id=replay-root><table><tr><td>fallback</td></tr></table></div>"
        f"<script id=replay-data>window.__REPLAY_DATA__ = {data};</script>"
        + "".join(f"<script type=module>\n{js}\n</script>" for js in scripts)
        + "</body></html>"
    )
    out = tmp_path / f"export-{order}.html"
    out.write_text(html, encoding="utf-8")
    page, errors = _page(browser)
    page.goto(out.as_uri())
    page.wait_for_selector(".rp-step")
    assert page.locator("#replay-root table").count() == 0
    assert page.locator(".rp-title").inner_text() == "team-outside-01"
    # graph:null -> taken from workflow_start.data.graph
    page.get_by_role("button", name="Map").click()
    assert page.locator(".rp-node").count() == 10
    assert page.locator(".rp-ask").count() == 0
    assert not errors, errors


# ── dashboard + live run + approval through the You lane ─────────────


_PROVIDER_KEYS = ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY")


def _no_provider_keys(monkeypatch) -> None:
    """A real aiui server runs startup hooks; keep them from calling paid APIs."""
    for key in _PROVIDER_KEYS:
        monkeypatch.delenv(key, raising=False)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def live_server(tmp_path, monkeypatch):
    import uvicorn

    import praisonaiui.server as server
    from praisonaiui.features import approvals
    from praisonaiui.features.replay import configure_replay_app

    traces = tmp_path / "traces"
    traces.mkdir()
    for name in ("team_handoff", "flow_parallel_loop"):
        shutil.copy(FIXTURES / f"{name}.jsonl", traces / f"{name}.jsonl")
    lines = (FIXTURES / "team_handoff.jsonl").read_text(encoding="utf-8").splitlines(keepends=True)
    cut = next(i for i, line in enumerate(lines) if '"approval_decided"' in line)
    live = traces / "live-team.jsonl"
    live.write_text("".join(lines[:cut]), encoding="utf-8")
    monkeypatch.setenv("PRAISONAI_TRACES_DIR", str(traces))
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "aiui-data"))
    monkeypatch.setenv("PRAISONAI_HOME", str(tmp_path / "praisonai-home"))
    _no_provider_keys(monkeypatch)
    store = approvals.SimpleApprovalManager()
    monkeypatch.setattr(approvals, "_approval_manager", store)

    server.reset_state()
    configure_replay_app()
    app = server.create_app()
    port = _free_port()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield {"url": f"http://127.0.0.1:{port}", "store": store, "live": live, "lines": lines, "cut": cut}
    srv.should_exit = True
    t.join(timeout=5)
    server.reset_state()


def test_dashboard_live_run_and_approval(browser, live_server):
    pytest.importorskip("praisonaiagents.approval.protocols")
    from praisonaiagents.approval.protocols import ApprovalRequest

    from praisonaiui.features.approvals import _UIStoreBackend

    store = live_server["store"]
    backend = _UIStoreBackend(store, timeout=30)
    box = {}
    req = ApprovalRequest(tool_name="write_file", arguments={"path": "draft.md", "content": "hello"},
                          risk_level="high", agent_name="Writer", approval_id="appr-0001")
    t = threading.Thread(target=lambda: box.setdefault("d", backend.request_approval_sync(req)), daemon=True)
    t.start()

    page, errors = _page(browser)
    page.goto(f"{live_server['url']}/#/replay?run=live-team")
    page.wait_for_selector(".rp-run")
    assert page.evaluate("location.pathname + location.search") == "/replay?run=live-team"
    assert page.locator(".rp-run[aria-current='true']").inner_text().startswith("Solar sail brief")
    assert page.locator(".rp-badge.rp-b-live").count() >= 1

    card = page.locator(".rp-ask")
    card.wait_for()
    assert "Writer asks to run write_file" in card.inner_text()
    page.get_by_role("button", name="Edit arguments…").click()
    ta = page.locator(".rp-ask textarea")
    ta.wait_for()
    assert json.loads(ta.input_value()) == {"path": "draft.md", "content": "hello"}  # server-held args, not redacted
    ta.fill("{not json")
    assert ta.get_attribute("aria-invalid") == "true"
    assert "Not valid JSON" in page.locator(".rp-ask .rp-err").inner_text()
    ta.fill('{"path": "docs/draft.md", "content": "hello"}')
    assert ta.get_attribute("aria-invalid") == "false"
    violations = _axe(page)
    assert violations == [], json.dumps(violations, indent=2)
    page.get_by_role("button", name="Approve with these arguments").click()
    t.join(timeout=10)
    decision = box["d"]
    assert decision.approved is True
    assert decision.modified_args == {"path": "docs/draft.md", "content": "hello"}
    page.locator(".rp-ask [role='status']").wait_for()

    # the run continues: the rest of the file streams in over SSE
    with open(live_server["live"], "a", encoding="utf-8") as fh:
        fh.write("".join(live_server["lines"][live_server["cut"]:]))
    page.wait_for_selector(".rp-step:has-text('You approved write_file')", timeout=10000)
    page.wait_for_selector(".rp-step:has-text('Recording ended.')", timeout=10000)
    assert page.locator(".rp-ask").count() == 0
    page.wait_for_selector(".rp-bar .rp-b-completed", timeout=15000)
    assert not [e for e in errors if "favicon" not in e], errors


def test_empty_state_explains_how_to_record(browser, tmp_path, monkeypatch):
    import uvicorn

    import praisonaiui.server as server
    from praisonaiui.features.replay import configure_replay_app

    monkeypatch.setenv("PRAISONAI_TRACES_DIR", str(tmp_path / "empty"))
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "aiui-data"))
    monkeypatch.setenv("PRAISONAI_HOME", str(tmp_path / "praisonai-home"))
    _no_provider_keys(monkeypatch)
    server.reset_state()
    configure_replay_app()
    app = server.create_app()
    port = _free_port()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    th = threading.Thread(target=srv.run, daemon=True)
    th.start()
    try:
        for _ in range(100):
            if srv.started:
                break
            time.sleep(0.05)
        page, _ = _page(browser)
        page.goto(f"http://127.0.0.1:{port}/")
        page.wait_for_selector(".rp-empty")
        text = page.locator(".rp-empty").inner_text()
        assert "praisonai replay view agents.yaml" in text
        assert "with record(live=True):" in text
        violations = _axe(page)
        assert violations == [], json.dumps(violations, indent=2)
    finally:
        srv.should_exit = True
        th.join(timeout=5)
        server.reset_state()
