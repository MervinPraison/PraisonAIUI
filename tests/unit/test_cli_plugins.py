"""``aiui plugins list|doctor`` and lazily mounted plugin CLIs (WP7)."""

from __future__ import annotations

import importlib.metadata as importlib_metadata
import json
import logging
import sys
import textwrap

import pytest
from rich.console import Console
from typer.testing import CliRunner

registry_mod = pytest.importorskip("praisonaiui.plugin_registry")

import praisonaiui.cli as cli_mod  # noqa: E402
from praisonaiui.cli import UI_STYLES, app  # noqa: E402

GROUP = "praisonaiui.plugins"

FAKECLI = textwrap.dedent(
    '''
    from pathlib import Path

    import typer

    from praisonaiui.plugin_registry import ToolRendererSpec

    class Plugin:
        name = "fakecli"
        version = "1.2.3"
        sdk = 1

        def pages(self):
            return [
                {"id": "fake-page", "title": "Fake", "kind": "react", "module": "fake.js"},
                {"id": "logs", "title": "Shadowed", "kind": "blocks"},
            ]

        def tool_renderers(self):
            return [ToolRendererSpec(tool_name="fake_tool", module="fake.js")]

        def routes(self):
            return []

        def static_dir(self):
            return Path(__file__).parent / "fakecli_static"

        def cli_commands(self):
            cli = typer.Typer()

            @cli.command()
            def hi(name: str = "x"):
                typer.echo(f"hi {name} from fakecli")

            @cli.command()
            def version():
                typer.echo("1.2.3")

            return cli

    plugin = Plugin()
    '''
)

BADASSETS = textwrap.dedent(
    '''
    from pathlib import Path

    class Plugin:
        name = "badassets"
        def pages(self):
            return [{"id": "bad-page", "title": "Bad", "kind": "react", "module": "missing.js"}]
        def static_dir(self):
            return Path(__file__).parent / "fakecli_static"

    plugin = Plugin()
    '''
)


def _write_dist(root, dist, eps):
    info = root / f"{dist}-1.2.3.dist-info"
    info.mkdir(parents=True)
    (info / "METADATA").write_text(f"Metadata-Version: 2.1\nName: {dist}\nVersion: 1.2.3\n")
    lines = [f"[{GROUP}]"] + [f"{k} = {v}" for k, v in eps.items()]
    (info / "entry_points.txt").write_text("\n".join(lines) + "\n")


_MODULES = ("fakecli_mod", "badassets_mod", "brokencli_mod")


@pytest.fixture
def site(tmp_path, monkeypatch):
    """A tmp site-packages dir with real dist-info entry points on sys.path."""
    sp = tmp_path / "site"
    sp.mkdir()
    (sp / "fakecli_mod.py").write_text(FAKECLI)
    (sp / "badassets_mod.py").write_text(BADASSETS)
    (sp / "brokencli_mod.py").write_text("raise RuntimeError('boom at import')\n")
    static = sp / "fakecli_static"
    static.mkdir()
    (static / "fake.js").write_text("export default function Fake() { return null }\n")
    _write_dist(sp, "fakecli", {"fakecli": "fakecli_mod:plugin"})
    _write_dist(sp, "badassets", {"badassets": "badassets_mod:plugin"})
    _write_dist(sp, "brokencli", {"brokencli": "brokencli_mod:plugin"})
    monkeypatch.syspath_prepend(str(sp))
    monkeypatch.delenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", raising=False)
    for m in _MODULES:
        sys.modules.pop(m, None)
    registry_mod.get_plugin_registry().reset()
    # Another test in the same worker may leave a root log handler that writes to
    # stdout (a RichHandler); the registry's "failed to load" warning would then
    # land in CliRunner's output ahead of the --json document.
    # The NullHandler keeps logging.lastResort (stderr, which CliRunner folds
    # into result.output) quiet once propagation is off.
    registry_log = logging.getLogger(registry_mod.__name__)
    monkeypatch.setattr(registry_log, "propagate", False)
    monkeypatch.setattr(registry_log, "handlers", [logging.NullHandler()])
    # Wide, colourless console so assertions see whole table cells.
    monkeypatch.setattr(cli_mod, "console", Console(width=400, no_color=True, highlight=False))
    yield sp
    registry_mod.get_plugin_registry().reset()
    for m in _MODULES:
        sys.modules.pop(m, None)


@pytest.fixture
def ep_calls(monkeypatch):
    """Count every entry_points() call (importlib.metadata and the registry's import)."""
    calls = []
    real = importlib_metadata.entry_points

    def counting(*args, **kwargs):
        calls.append((args, kwargs))
        return real(*args, **kwargs)

    monkeypatch.setattr(importlib_metadata, "entry_points", counting)
    monkeypatch.setattr(registry_mod, "entry_points", counting)
    return calls


def _invoke(*args, **kwargs):
    return CliRunner().invoke(app, list(args), **kwargs)


# ── laziness ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("argv", [["--help"], ["plugins", "--help"], ["run", "--help"], ["sessions", "--help"]])
def test_help_never_discovers_plugins(site, ep_calls, argv):
    result = _invoke(*argv)
    assert result.exit_code == 0, result.output
    assert ep_calls == [], f"{argv} called entry_points()"
    assert "fakecli_mod" not in sys.modules


def test_plugins_help_is_ascii():
    """`aiui --help` lists this text; a non-ASCII char (e.g. an ellipsis)
    makes rich import its unicode width table on every --help (~5 ms)."""
    assert cli_mod.plugins_app.info.help.isascii()


def test_builtin_command_does_not_discover_plugins(site, ep_calls, tmp_path):
    result = _invoke("validate", "--config", str(tmp_path / "missing.yaml"))
    assert result.exit_code != 0
    assert ep_calls == []


def test_unknown_command_mounts_plugin_cli(site, ep_calls):
    result = _invoke("fakecli", "hi", "--name", "Ada")
    assert result.exit_code == 0, result.output
    assert "hi Ada from fakecli" in result.output
    assert ep_calls, "discovery runs for an unknown sub-command"

    result = _invoke("plugins", "fakecli", "version")
    assert result.exit_code == 0, result.output
    assert "1.2.3" in result.output


def test_unknown_command_without_plugin_still_errors(site):
    result = _invoke("definitely-not-a-command")
    assert result.exit_code != 0
    assert "No such command" in result.output


def test_autoload_disabled_skips_plugin_cli(site, ep_calls, monkeypatch):
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")
    result = _invoke("fakecli", "hi")
    assert result.exit_code != 0
    assert "No such command" in result.output
    assert ep_calls == []
    assert "fakecli_mod" not in sys.modules


# ── plugins list ─────────────────────────────────────────────────────


def test_plugins_list_table(site):
    result = _invoke("plugins", "list")
    assert result.exit_code == 0, result.output
    out = result.output
    assert "fakecli" in out and "1.2.3" in out
    assert "brokencli" in out and "boom at import" in out
    line = next(ln for ln in out.splitlines() if "fakecli" in ln and "fakecli_mod" in ln)
    assert " ok " in line


def test_plugins_list_json(site):
    result = _invoke("plugins", "list", "--json")
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    rows = {p["name"]: p for p in data["plugins"]}
    assert data["autoload"] is True
    assert rows["fakecli"]["status"] == "ok"
    assert rows["fakecli"]["version"] == "1.2.3"
    assert rows["brokencli"]["status"] == "error"
    assert "boom at import" in rows["brokencli"]["error"]


def test_plugins_list_honours_extensions_config(site, tmp_path):
    cfg = tmp_path / "aiui.yaml"
    cfg.write_text("extensions:\n  disabled: [brokencli]\n")
    result = _invoke("plugins", "list", "--json", "--config", str(cfg))
    assert result.exit_code == 0, result.output
    rows = {p["name"]: p for p in json.loads(result.output)["plugins"]}
    assert rows["brokencli"]["status"] == "disabled"
    assert "brokencli_mod" not in sys.modules


def test_plugins_list_with_autoload_disabled_lists_without_importing(site, monkeypatch):
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")
    result = _invoke("plugins", "list", "--json")
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    rows = {p["name"]: p for p in data["plugins"]}
    assert data["autoload"] is False
    assert rows["fakecli"]["status"] == "not loaded"
    assert "fakecli_mod" not in sys.modules and "brokencli_mod" not in sys.modules
    table = _invoke("plugins", "list")
    assert "autoload is disabled" in table.output


# ── plugins doctor ───────────────────────────────────────────────────


def test_plugins_doctor_reports_failures(site):
    result = _invoke("plugins", "doctor", "--no-builtin")
    assert result.exit_code == 1, result.output
    out = result.output
    assert "boom at import" in out
    assert "missing.js not found" in out
    assert "/_plugins/fakecli/fake.js" in out
    assert "aiui fakecli" in out


def test_plugins_doctor_passes_and_reports_shadowed_ids(site, tmp_path):
    cfg = tmp_path / "aiui.yaml"
    cfg.write_text("extensions:\n  disabled: [brokencli, badassets]\n")
    result = _invoke("plugins", "doctor", "--config", str(cfg))
    assert result.exit_code == 0, result.output
    assert "page 'logs' is shadowed by a built-in page" in result.output
    assert "0 failure(s)" in result.output


def test_plugins_doctor_detects_integrity_mismatch(site, monkeypatch):
    from praisonaiui.plugin_registry import PageSpec

    mod = __import__("fakecli_mod")
    monkeypatch.setattr(
        mod.Plugin,
        "pages",
        lambda self: [PageSpec(id="fake-page", title="F", kind="react", module="fake.js", integrity="sha384-AAAA")],
    )
    cfg = site / "cfg.yaml"
    cfg.write_text("extensions:\n  enabled: [fakecli]\n")
    result = _invoke("plugins", "doctor", "--no-builtin", "--config", str(cfg))
    assert result.exit_code == 1, result.output
    assert "integrity mismatch" in result.output


# ── --style ──────────────────────────────────────────────────────────


def test_run_style_accepts_app():
    assert "app" in UI_STYLES
    result = _invoke("run", "--help", env={"COLUMNS": "300"})
    assert "'app'" in result.output


def test_run_rejects_unknown_style(tmp_path):
    app_file = tmp_path / "app.py"
    app_file.write_text("")
    result = _invoke("run", str(app_file), "--style", "nope")
    assert result.exit_code == 2
    assert "Unknown --style" in result.output
