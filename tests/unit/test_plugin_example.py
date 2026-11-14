"""The example plugin (examples/plugins/aiui-hello-plugin) installed as a real
distribution: manifest, static files with SRI, the blocks endpoint and the
browser module's imports (WP7)."""

from __future__ import annotations

import base64
import hashlib
import re
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

registry_mod = pytest.importorskip("praisonaiui.plugin_registry")

import praisonaiui.server as srv  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / "examples" / "plugins" / "aiui-hello-plugin"
HELLO_JS = EXAMPLE / "aiui_hello" / "static" / "hello.js"
MANIFEST_TS = ROOT / "src" / "frontend" / "src" / "sdk" / "manifest.ts"


def _sri(path: Path) -> str:
    return "sha384-" + base64.b64encode(hashlib.sha384(path.read_bytes()).digest()).decode()


def _ts_string_list(name: str) -> list[str]:
    """Read `export const NAME = [ 'a', 'b' ] as const` from sdk/manifest.ts."""
    src = MANIFEST_TS.read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = \[(.*?)\]", src, re.S)
    assert m, f"{name} not found in {MANIFEST_TS}"
    return re.findall(r"'([^']+)'", m.group(1))


@pytest.fixture
def hello_site(tmp_path, monkeypatch):
    """Install the example via a dist-info entry point (like `pip install -e`)."""
    sp = tmp_path / "site"
    info = sp / "aiui_hello_plugin-0.1.0.dist-info"
    info.mkdir(parents=True)
    (info / "METADATA").write_text("Metadata-Version: 2.1\nName: aiui-hello-plugin\nVersion: 0.1.0\n")
    (info / "entry_points.txt").write_text("[praisonaiui.plugins]\nhello = aiui_hello:plugin\n")
    monkeypatch.syspath_prepend(str(sp))
    monkeypatch.syspath_prepend(str(EXAMPLE))
    monkeypatch.delenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", raising=False)
    monkeypatch.delenv("AIUI_SHELL", raising=False)
    sys.modules.pop("aiui_hello", None)
    srv.reset_state()
    yield sp
    srv.reset_state()
    sys.modules.pop("aiui_hello", None)


@pytest.fixture
def client(hello_site):
    # TestClient is not a loopback client, so plugin browser surfaces are
    # default-deny: enable the example by name, as a deployment would.
    registry_mod.set_extensions(enabled=["hello"])
    return TestClient(srv.create_app())


def test_manifest_lists_hello_pages_with_sri(client):
    r = client.get("/api/shell/manifest")
    assert r.status_code == 200
    m = r.json()
    pages = {p["id"]: p for p in m["pages"]}

    hello = pages["hello"]
    assert hello["kind"] == "react"
    assert hello["module"] == "/_plugins/hello/hello.js"
    assert hello["integrity"] == _sri(HELLO_JS)
    assert hello["integrity"].startswith("sha384-")
    assert hello["source"] == "plugin:hello"

    blocks = pages["hello-blocks"]
    assert blocks["kind"] == "blocks"
    assert blocks["apiEndpoint"] == "/api/plugins/hello/pages/hello-blocks"

    tools = {t["toolName"]: t for t in m["toolRenderers"]}
    assert tools["get_weather"]["module"] == "/_plugins/hello/hello.js"
    assert tools["get_weather"]["integrity"] == _sri(HELLO_JS)

    block_types = {b["type"]: b for b in m["blocks"]}
    assert block_types["hello_badge"]["module"] == "/_plugins/hello/hello.js"
    assert block_types["hello_badge"]["integrity"] == _sri(HELLO_JS)
    assert block_types["hello_badge"]["source"] == "plugin:hello"

    plugins = {p["name"]: p for p in m["plugins"]}
    assert plugins["hello"]["status"] == "ok"
    assert plugins["hello"]["version"] == "0.1.0"


def test_static_module_is_served(client):
    r = client.get("/_plugins/hello/hello.js")
    assert r.status_code == 200
    assert "javascript" in r.headers["content-type"]
    assert r.content == HELLO_JS.read_bytes()
    # Only static/ is served, never the package's Python source.
    for path in ("/_plugins/hello/../__init__.py", "/_plugins/hello/..%2F__init__.py"):
        assert "class HelloPlugin" not in client.get(path).text


def test_blocks_endpoint_and_action(client):
    r = client.get("/api/plugins/hello/pages/hello-blocks")
    assert r.status_code == 200
    comps = r.json()["_components"]
    types = [c["type"] for c in comps]
    assert {"header", "text", "stat_group", "columns", "table", "button_group", "hello_badge"} <= set(types)
    assert "chart" in types  # not a core block: exercises the legacy fallback
    button = next(c for c in comps if c["type"] == "button_group")["buttons"][0]
    assert button["action"] == "greet"

    r = client.post("/api/plugins/hello/pages/hello-blocks/action", json={"action": "greet"})
    assert r.status_code == 200
    data = r.json()
    assert data["message"].startswith("Greeting #")
    assert any(c["type"] == "alert" for c in data["_components"])

    assert client.post("/api/plugins/hello/pages/hello-blocks/action", json={"action": "x"}).status_code == 400


def test_plugin_js_is_default_deny_when_not_enabled(hello_site):
    # Non-loopback client, no extensions.enabled: Python routes stay, JS is off.
    c = TestClient(srv.create_app())
    m = c.get("/api/shell/manifest").json()
    assert "hello" not in {p["id"] for p in m["pages"]}
    assert {p["name"]: p for p in m["plugins"]}["hello"]["status"] == "disabled-by-default"
    assert c.get("/_plugins/hello/hello.js").status_code == 404


def test_hello_js_imports_only_shell_externals():
    src = HELLO_JS.read_text(encoding="utf-8")
    imports = re.findall(r"^import\s+(.+?)\s+from\s+'([^']+)'", src, re.M)
    assert imports, "hello.js has static imports"
    externals = set(_ts_string_list("SHELL_EXTERNALS"))
    sdk_exports = set(_ts_string_list("SDK_EXPORTS"))
    assert {spec for _, spec in imports} <= externals
    for names, spec in imports:
        if spec == "@aiui/sdk":
            imported = {n.strip().split(" as ")[0] for n in names.strip("{} ").split(",") if n.strip()}
            assert imported <= sdk_exports, imported - sdk_exports
    assert "export default function" in src
    assert "registerToolRenderer('get_weather'" in src
    assert "registerBlock('hello_badge'" in src


def test_example_entry_point_matches_pyproject():
    text = (EXAMPLE / "pyproject.toml").read_text(encoding="utf-8")
    assert '[project.entry-points."praisonaiui.plugins"]' in text
    assert 'hello = "aiui_hello:plugin"' in text


def test_example_page_icons_are_mapped_by_the_shell(hello_site):
    """Icon names a plugin passes must be in the shell's static lucide map
    (src/frontend/src/shell/icons.ts ICON_BY_NAME), else they show FileText."""
    icons_ts = ROOT / "src" / "frontend" / "src" / "shell" / "icons.ts"
    if not icons_ts.exists():
        pytest.skip("React shell (WP6) not present")
    src = icons_ts.read_text(encoding="utf-8")
    m = re.search(r"ICON_BY_NAME[^=]*=\s*\{(.*?)\n\}", src, re.S)
    assert m, "ICON_BY_NAME not found"
    names = set(re.findall(r"^\s*'?([a-z][a-z-]*)'?\s*:", m.group(1), re.M))
    import aiui_hello

    for page in aiui_hello.plugin.pages():
        assert page["icon"] in names, page


def test_example_depends_on_the_real_distribution():
    """``pip install`` of the example must resolve: the host's PyPI name is
    the one in the root pyproject (``aiui``), not the import name."""
    tomllib = pytest.importorskip("tomllib")
    host = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    example = tomllib.loads((EXAMPLE / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    deps = [re.split(r"[\s<>=!~;\[]", d, maxsplit=1)[0] for d in example["dependencies"]]
    assert host["name"] in deps
    assert example["name"].startswith("aiui-")
    assert example["requires-python"] == host["requires-python"]


def test_doctor_passes_for_the_example(hello_site, monkeypatch):
    from rich.console import Console
    from typer.testing import CliRunner

    import praisonaiui.cli as cli_mod

    monkeypatch.setattr(cli_mod, "console", Console(width=400, no_color=True, highlight=False))
    result = CliRunner().invoke(cli_mod.app, ["plugins", "doctor", "--no-builtin"])
    assert result.exit_code == 0, result.output
    assert "/_plugins/hello/hello.js" in result.output

    greet = CliRunner().invoke(cli_mod.app, ["hello", "greet", "Ada"])
    assert greet.exit_code == 0, greet.output
    assert "Hello, Ada!" in greet.output
