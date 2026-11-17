"""Default site config lookup: ``aiui.yaml``, else the old ``aiui.template.yaml``."""

from pathlib import Path

import pytest
from typer.testing import CliRunner

from praisonaiui.cli import _find_config, _resolve_config
from praisonaiui.cli import app as cli_app

CONFIG = "schemaVersion: 1\nsite:\n  title: T\n"
OLD_NOTICE = "Using aiui.template.yaml; rename it to aiui.yaml (the old name keeps working)."
BOTH_NOTICE = "Using aiui.yaml; aiui.template.yaml is also here and is ignored."


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return tmp_path


def _write(project: Path, *names: str) -> None:
    for name in names:
        (project / name).write_text(CONFIG, encoding="utf-8")


# ── the helper ─────────────────────────────────────────────────────────────


def test_only_new_name(project, capsys):
    _write(project, "aiui.yaml")
    assert _resolve_config(None) == Path("aiui.yaml")
    assert capsys.readouterr().err == ""


def test_only_old_name_prints_the_notice_on_stderr(project, capsys):
    _write(project, "aiui.template.yaml")
    assert _resolve_config(None) == Path("aiui.template.yaml")
    out = capsys.readouterr()
    assert out.err.strip() == OLD_NOTICE
    assert out.out == ""


def test_both_names_prefer_the_new_one(project, capsys):
    _write(project, "aiui.yaml", "aiui.template.yaml")
    assert _resolve_config(None) == Path("aiui.yaml")
    assert capsys.readouterr().err.strip() == BOTH_NOTICE


def test_explicit_config_wins_silently(project, capsys):
    _write(project, "aiui.yaml", "aiui.template.yaml")
    explicit = Path("aiui.template.yaml")
    assert _resolve_config(explicit) is explicit
    assert capsys.readouterr().err == ""


def test_neither_name_falls_back_to_the_new_name(project, capsys):
    assert _resolve_config(None) == Path("aiui.yaml")
    assert capsys.readouterr().err == ""


def test_find_config_in_a_directory(tmp_path):
    assert _find_config(tmp_path) is None
    _write(tmp_path, "aiui.template.yaml")
    assert _find_config(tmp_path) == tmp_path / "aiui.template.yaml"
    _write(tmp_path, "aiui.yaml")
    assert _find_config(tmp_path) == tmp_path / "aiui.yaml"


def test_aiui_yml_is_not_looked_up(tmp_path):
    _write(tmp_path, "aiui.yml")
    assert _find_config(tmp_path) is None


# ── the commands ───────────────────────────────────────────────────────────


def test_validate_with_old_name_passes_with_notice(project):
    _write(project, "aiui.template.yaml")
    result = CliRunner().invoke(cli_app, ["validate"])
    assert result.exit_code == 0, result.output
    assert OLD_NOTICE in result.stderr
    assert OLD_NOTICE not in result.stdout
    assert "Configuration is valid" in result.stdout


def test_validate_with_new_name_has_no_notice(project):
    _write(project, "aiui.yaml")
    result = CliRunner().invoke(cli_app, ["validate"])
    assert result.exit_code == 0, result.output
    assert result.stderr == ""


def test_validate_explicit_old_name_has_no_notice(project):
    _write(project, "aiui.template.yaml")
    result = CliRunner().invoke(cli_app, ["validate", "--config", "aiui.template.yaml"])
    assert result.exit_code == 0, result.output
    assert result.stderr == ""


def test_validate_without_any_config_names_aiui_yaml(project):
    result = CliRunner().invoke(cli_app, ["validate"])
    assert result.exit_code == 2
    assert "Configuration file not found: aiui.yaml" in result.output


def test_build_with_old_name_builds_and_keeps_exit_code(project):
    _write(project, "aiui.template.yaml")
    result = CliRunner().invoke(cli_app, ["build", "--output", str(project / "out")])
    assert result.exit_code == 0, result.output
    assert OLD_NOTICE in result.stderr
    assert (project / "out" / "ui-config.json").is_file()


def test_build_prefers_aiui_yaml(project):
    (project / "aiui.yaml").write_text(
        "schemaVersion: 1\nsite:\n  title: New Name\n", encoding="utf-8"
    )
    (project / "aiui.template.yaml").write_text(
        "schemaVersion: 1\nsite:\n  title: Old Name\n", encoding="utf-8"
    )
    result = CliRunner().invoke(cli_app, ["build", "--output", str(project / "out")])
    assert result.exit_code == 0, result.output
    assert BOTH_NOTICE in result.stderr
    built = (project / "out" / "ui-config.json").read_text(encoding="utf-8")
    assert "New Name" in built and "Old Name" not in built


def test_init_writes_aiui_yaml(project):
    result = CliRunner().invoke(cli_app, ["init"])
    assert result.exit_code == 0, result.output
    assert (project / "aiui.yaml").is_file()
    assert not (project / "aiui.template.yaml").exists()


def test_init_refuses_to_overwrite_aiui_yaml(project):
    (project / "aiui.yaml").write_text("keep: me\n", encoding="utf-8")
    result = CliRunner().invoke(cli_app, ["init"])
    assert result.exit_code == 1
    assert "aiui.yaml already exists" in result.output
    assert (project / "aiui.yaml").read_text(encoding="utf-8") == "keep: me\n"


def test_init_refuses_when_only_the_old_name_exists(project):
    (project / "aiui.template.yaml").write_text("keep: me\n", encoding="utf-8")
    result = CliRunner().invoke(cli_app, ["init"])
    assert result.exit_code == 1
    assert "aiui.template.yaml already exists" in result.output
    assert not (project / "aiui.yaml").exists()


def test_init_force_writes_aiui_yaml_next_to_the_old_name(project):
    (project / "aiui.template.yaml").write_text("keep: me\n", encoding="utf-8")
    result = CliRunner().invoke(cli_app, ["init", "--force"])
    assert result.exit_code == 0, result.output
    assert (project / "aiui.yaml").is_file()
    assert (project / "aiui.template.yaml").read_text(encoding="utf-8") == "keep: me\n"
