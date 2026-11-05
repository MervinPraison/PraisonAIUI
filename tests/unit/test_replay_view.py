"""PraisonAI Replay dashboard view: registration and wiring (source-grep, like test_run_recorder)."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
VIEWS = FRONTEND / "views"
CORE = VIEWS / "replay-core.js"
VIEW = VIEWS / "replay.js"


def test_view_files_exist():
    assert CORE.exists()
    assert VIEW.exists()


def test_replay_registered_in_builtin_views():
    source = (FRONTEND / "dashboard.js").read_text(encoding="utf-8")
    block = source.split("const BUILTIN_VIEWS = {", 1)[1].split("};", 1)[0]
    assert re.search(r"^\s*replay:\s*'/plugins/views/replay\.js',", block, re.M)


def test_dashboard_accepts_hash_deep_links():
    source = (FRONTEND / "dashboard.js").read_text(encoding="utf-8")
    assert "location.hash.match(" in source
    assert "history.replaceState(null, '', `/${hashRoute[1]}" in source


def test_core_exports_pure_api():
    source = CORE.read_text(encoding="utf-8")
    for fn in (
        "export function buildModel",
        "export function narrate",
        "export function layoutMap",
        "export function deriveGraph",
    ):
        assert fn in source, fn
    assert "globalThis.PraisonReplayCore = api" in source
    # pure: no DOM and no network
    for banned in ("document.", "window.", "fetch(", "EventSource", "localStorage"):
        assert banned not in source, banned


def test_view_exports_render_and_cleanup():
    source = VIEW.read_text(encoding="utf-8")
    assert "export async function render" in source
    assert "export function cleanup" in source
    assert "abort" in source.lower()
    assert "es.close()" in source


def test_view_uses_contract_endpoints():
    source = VIEW.read_text(encoding="utf-8")
    for url in (
        "/api/replay/runs",
        "/api/replay/runs/${encodeURIComponent(id)}/events",
        "/api/replay/runs/${encodeURIComponent(id)}/stream",
        "/api/approvals/${encodeURIComponent(b.approvalId)}/${action}",
        "modified_args",
    ):
        assert url in source, url


def test_no_cdn_or_third_party_assets():
    for path in (CORE, VIEW):
        text = path.read_text(encoding="utf-8")
        stripped = text.replace("http://www.w3.org/2000/svg", "")
        assert "http://" not in stripped and "https://" not in stripped, path.name
        assert not re.search(r"cdn[\w-]*\.[a-z]{2,}", stripped.lower()), path.name
        assert "mermaid" not in stripped.lower(), path.name
        assert not re.search(r"^\s*import .* from ['\"](?!\./|/plugins/)", text, re.M), path.name


def test_palette_and_shapes_follow_contract():
    core = CORE.read_text(encoding="utf-8")
    for colour in ("#8B0000", "#0F7287", "#8A5A00", "#3C4A5C"):
        assert colour in core
    assert "#189AB4" not in core + VIEW.read_text(encoding="utf-8")
    for pair in ("agent: 'circle'", "tool: 'rounded'", "human: 'diamond'", "manager: 'square'"):
        assert pair in core


def test_accessibility_hooks_present():
    view = VIEW.read_text(encoding="utf-8")
    assert "prefers-reduced-motion" in view
    assert ":focus-visible" in view
    assert "aria-live" in view
    assert "role: 'tablist'" in view and "role: 'tab'" in view and "role: 'tabpanel'" in view
    assert "aria-current" in view
    assert "'ArrowLeft'" in view and "'ArrowRight'" in view
    assert "praisonai replay view agents.yaml" in view
    assert "with record(" in view
    assert "Studio" not in view and "__start__" not in view


def test_standalone_boot_contract():
    view = VIEW.read_text(encoding="utf-8")
    assert "globalThis.__REPLAY_DATA__" in view
    assert "replay-root" in view
    assert "globalThis.PraisonReplayCore" in view


def test_replay_core_node_suite():
    """Runs tests/js/replay-core.test.mjs (buildModel, narrate, layoutMap) when Node is present."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    proc = subprocess.run(
        [node, "--test", str(ROOT / "tests" / "js" / "replay-core.test.mjs")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-2000:]
    assert re.search(r"# fail 0", proc.stdout)


def test_replay_page_uses_own_svg_mark_not_emoji_heading():
    from praisonaiui.features.replay import REPLAY_MARK_SVG

    assert REPLAY_MARK_SVG.startswith('<svg xmlns="http://www.w3.org/2000/svg"')
    for banned in ("<script", "foreignObject", "onload", "javascript:"):
        assert banned not in REPLAY_MARK_SVG
    server_src = (ROOT / "src" / "praisonaiui" / "server.py").read_text(encoding="utf-8")
    assert '"icon_svg": REPLAY_MARK_SVG' in server_src
    dash = (FRONTEND / "dashboard.js").read_text(encoding="utf-8")
    assert "function safeSvgIcon" in dash and "parsererror, script, foreignObject" in dash
    assert "setPageIcon(iconSpan, page" in dash


def test_dashboard_mobile_shell_gives_content_the_width():
    dash = (FRONTEND / "dashboard.js").read_text(encoding="utf-8")
    assert ".db-sidebar { position: fixed !important;" in dash
    assert "#db-shell-header-slot { flex: 0 0 100%;" in dash
    assert ".db-main { padding: 64px 16px 16px; }" in dash


def test_theme_defaults_to_system():
    view = VIEW.read_text(encoding="utf-8")
    assert "@media (prefers-color-scheme:dark){.rp-root[data-theme=\"system\"]" in view
    assert "'Theme: system'" in view
