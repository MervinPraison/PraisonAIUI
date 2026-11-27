"""Tests for modern `aiui init --template <framework>` scaffolding."""

from __future__ import annotations

import ast

import pytest
from typer.testing import CliRunner

from praisonaiui._init_templates import APP_TEMPLATES
from praisonaiui.cli import app as cli_app

runner = CliRunner()


@pytest.mark.parametrize("template_name", sorted(APP_TEMPLATES.keys()))
def test_app_templates_scaffold_valid_python(tmp_path, monkeypatch, template_name):
    monkeypatch.chdir(tmp_path)
    res = runner.invoke(cli_app, ["init", "--template", template_name])
    assert res.exit_code == 0, res.output
    app_py = tmp_path / "app.py"
    assert app_py.is_file()
    source = app_py.read_text(encoding="utf-8")
    # Every generated starter must parse as valid Python.
    ast.parse(source)
    assert "import praisonaiui as aiui" in source


def test_app_template_refuses_overwrite_without_force(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert runner.invoke(cli_app, ["init", "--template", "agent"]).exit_code == 0
    second = runner.invoke(cli_app, ["init", "--template", "openai"])
    assert second.exit_code == 1
    assert "already exists" in second.output
    forced = runner.invoke(cli_app, ["init", "--template", "openai", "--force"])
    assert forced.exit_code == 0
    assert "AsyncOpenAI" in (tmp_path / "app.py").read_text(encoding="utf-8")


def test_unknown_template_exits_with_code_2(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    res = runner.invoke(cli_app, ["init", "--template", "nonexistent"])
    assert res.exit_code == 2
    assert "Unknown template" in res.output


def test_default_minimal_template_still_writes_aiui_yaml(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    res = runner.invoke(cli_app, ["init"])
    assert res.exit_code == 0, res.output
    assert (tmp_path / "aiui.yaml").is_file()
