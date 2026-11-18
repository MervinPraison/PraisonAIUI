"""``aiui run chat.yaml``: every top-level key is applied or reported.

``layout:`` and ``extensions:`` were accepted and silently dropped (the run
kept the default Chat layout and every built-in), and a misspelt key gave no
hint. They now apply through ``set_layout`` / ``set_extensions``, and any
other key ``aiui run`` does not read prints one warning naming it.
"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

import praisonaiui.server as srv
from praisonaiui import _run_factory
from praisonaiui.cli import app as cli_app


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    import uvicorn

    from praisonaiui import layouts
    from praisonaiui.plugin_registry import get_plugin_registry

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("AIUI_LAYOUT", raising=False)
    monkeypatch.setenv(_run_factory.SPEC_ENV, "")
    monkeypatch.delenv(_run_factory.SPEC_ENV)
    monkeypatch.setattr(uvicorn, "run", lambda *a, **kw: None)
    srv.reset_state()
    get_plugin_registry().reset()
    layouts.reset()
    yield
    srv.reset_state()
    get_plugin_registry().reset()
    layouts.reset()


def _run(tmp_path, text: str):
    cfg = tmp_path / "chat.yaml"
    cfg.write_text(text)
    result = CliRunner().invoke(
        cli_app, ["run", str(cfg), "--datastore", "memory", "--port", "8213"]
    )
    assert result.exit_code == 0, result.output
    return result.output


def test_unknown_key_prints_one_warning_naming_it(tmp_path):
    out = " ".join(_run(tmp_path, "name: Bot\ninstructions: Be nice\nwelcom: Hi\n").split())
    assert out.count("'welcom'") == 1
    assert "not used by aiui run" in out


def test_known_keys_print_no_warning(tmp_path):
    out = _run(
        tmp_path,
        "name: Bot\ninstructions: x\nwelcome: Hi\nstarters: []\nstyle: app\n"
        "layout: command\nextensions: {disabled: [builtin.cron]}\n",
    )
    assert "not used by aiui run" not in out


def test_layout_id_sets_the_default_layout(tmp_path):
    from praisonaiui.layouts import default_layout

    _run(tmp_path, "name: Bot\nstyle: app\nlayout: command\n")
    assert default_layout("app") == "command"


def test_layout_block_like_aiui_yaml(tmp_path):
    from praisonaiui.layouts import resolve

    _run(
        tmp_path,
        "name: Bot\nstyle: app\nlayout:\n  default: workbench\n  userChoice: false\n",
    )
    sel = resolve(None, "app")
    assert sel.default == "workbench"


@pytest.mark.parametrize("value", ['"Not A Layout!"', "[command]"])
def test_malformed_layout_warns_and_keeps_the_run_default(tmp_path, value):
    from praisonaiui.builtin.catalog import RUN_DEFAULT_LAYOUT
    from praisonaiui.layouts import default_layout

    out = _run(tmp_path, f"name: Bot\nstyle: app\nlayout: {value}\n")
    assert "layout: ignored" in " ".join(out.split())
    assert default_layout("app") == RUN_DEFAULT_LAYOUT


def test_extensions_disable_a_builtin(tmp_path):
    from praisonaiui.plugin_registry import get_plugin_registry

    _run(tmp_path, "name: Bot\nextensions:\n  disabled: [builtin.cron]\n")
    assert "builtin.cron" in get_plugin_registry().policy.disabled
