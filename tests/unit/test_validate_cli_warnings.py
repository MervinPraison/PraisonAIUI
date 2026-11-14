"""``aiui validate`` reports misspelled keys and prints theme warnings itself."""

from __future__ import annotations

import warnings

from typer.testing import CliRunner

from praisonaiui.cli import _format_loc
from praisonaiui.cli import app as cli_app
from praisonaiui.schema.models import Config
from praisonaiui.schema.validators import find_unknown_keys, legacy_hsl_warning

BASE = """schemaVersion: 1
site:
  title: Test
"""


def _validate(tmp_path, text: str, *extra: str):
    cfg = tmp_path / "aiui.template.yaml"
    cfg.write_text(text, encoding="utf-8")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = CliRunner().invoke(cli_app, ["validate", "--config", str(cfg), *extra])
    return result, caught


def test_misspelled_keys_are_warned_by_path(tmp_path):
    text = "stlye: app\nsite:\n  title: Test\n  themee:\n    preset: rose\n"
    result, _ = _validate(tmp_path, text)
    assert result.exit_code == 0, result.output
    assert "Unknown key 'stlye'" in result.output
    assert "Unknown key 'site.themee'" in result.output
    assert "Configuration is valid" in result.output


def test_strict_makes_unknown_keys_errors(tmp_path):
    result, _ = _validate(tmp_path, BASE + "stlye: app\n", "--strict")
    assert result.exit_code == 1
    assert "[config] Unknown key 'stlye'" in result.output


def test_clean_config_has_no_unknown_key_warning(tmp_path):
    result, _ = _validate(tmp_path, BASE)
    assert result.exit_code == 0
    assert "Unknown key" not in result.output


def test_hsl_triple_warning_is_printed_not_raised(tmp_path):
    text = BASE + '  customCss: ":root { --primary: 221 83% 53%; }"\n'
    result, caught = _validate(tmp_path, text)
    assert result.exit_code == 0, result.output
    assert "[theme] 5001" in result.output
    assert "--seed-accent: hsl(221 83% 53%)" in result.output  # the suggestion
    assert "react-shell.md#breaking-change-bare-hsl-triples" in result.output.replace("\n", "")
    assert not [w for w in caught if "--primary" in str(w.message)]


def test_hsl_warning_points_at_shipped_docs():
    msg = legacy_hsl_warning(":root{--primary: 221 83% 53%}")
    assert "DESIGN.md" not in msg
    assert "docs/features/react-shell.md#breaking-change-bare-hsl-triples" in msg


def test_walker_respects_extra_allow_and_nesting():
    data = {
        "site": {"title": "t"},
        "content": {"api": {"dir": "x"}, "docs": {"dir": "d", "nope": 1}},
        "components": {"c": {"type": "x", "props": {"anything": 1}, "foo": 2}},
    }
    assert find_unknown_keys(Config, data) == [
        ("content", "docs", "nope"),
        ("components", "c", "foo"),
    ]


def test_aliases_and_field_names_are_both_known():
    data = {"site": {"title": "t", "customCss": "a", "custom_css": "b"}}
    assert find_unknown_keys(Config, data) == []


def test_format_loc():
    assert _format_loc(("site", "theme", 0, "x")) == "site.theme[0].x"
