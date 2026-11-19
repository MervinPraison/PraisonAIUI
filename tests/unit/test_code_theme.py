"""Code block theme (site.theme.code) and extra grammars (site.theme.codeLanguages) in a docs build."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from praisonaiui.compiler import Compiler, code_theme
from praisonaiui.schema.models import Config

THEMES = {
    "github-light": {"type": "light", "bg": "#fff", "fg": "#24292e"},
    "github-dark": {"type": "dark", "bg": "#24292e", "fg": "#e1e4e8"},
    "dracula": {"type": "dark", "bg": "#282A36", "fg": "#F8F8F2"},
    "min-light": {"type": "light", "bg": "#ffffff", "fg": "#212121"},
}
GRAMMAR = {"name": "Greet", "scopeName": "source.greet", "fileTypes": ["greet", "gr"],
           "patterns": [{"match": "\\bhello\\b", "name": "keyword.control.greet"}]}


@pytest.fixture
def themes(monkeypatch):
    monkeypatch.setattr(code_theme, "bundled_themes", lambda: THEMES)


def _build(tmp_path: Path, **theme) -> tuple[Path, Compiler, list[str]]:
    docs = tmp_path / "docs"
    docs.mkdir(exist_ok=True)
    (docs / "index.md").write_text("# Home\n\n```greet\nhello\n```\n", encoding="utf-8")
    (tmp_path / "grammars").mkdir(exist_ok=True)
    (tmp_path / "grammars" / "greet.tmLanguage.json").write_text(json.dumps(GRAMMAR), encoding="utf-8")
    (tmp_path / "grammars" / "broken.json").write_text("{not json", encoding="utf-8")
    config = Config.model_validate({"site": {"title": "Acme", "basePath": "/acme", "theme": theme},
                                    "content": {"docs": {"dir": "docs"}}})
    compiler = Compiler(config, base_path=tmp_path)
    out = tmp_path / "out"
    result = compiler.compile(out)
    assert result.success, result.error
    return out, compiler, result.warnings


def _ui_theme(out: Path) -> dict:
    return json.loads((out / "ui-config.json").read_text())["site"]["theme"]


def test_one_theme_name_serves_both_modes_and_sets_the_code_background(tmp_path, themes):
    out, _, warnings = _build(tmp_path, code="Dracula")
    assert _ui_theme(out)["code"] == {"light": "dracula", "dark": "dracula"}
    css = (out / "assets" / "theme.css").read_text()
    assert ":root { --aiui-code-bg: #282A36; --aiui-code-fg: #F8F8F2; }" in css
    assert ":root.dark, :root .dark { --aiui-code-bg: #282A36; --aiui-code-fg: #F8F8F2; }" in css
    assert not warnings


def test_a_light_and_dark_pair_each_set_their_mode(tmp_path, themes):
    out, _, _ = _build(tmp_path, code={"light": "min-light"})
    assert _ui_theme(out)["code"] == {"light": "min-light", "dark": "github-dark"}
    css = (out / "assets" / "theme.css").read_text()
    assert ":root { --aiui-code-bg: #ffffff; --aiui-code-fg: #212121; }" in css
    assert ":root.dark, :root .dark { --aiui-code-bg: #24292e;" in css


def test_without_a_code_theme_nothing_changes(tmp_path, themes):
    out, _, _ = _build(tmp_path, preset="zinc")
    assert "code" not in _ui_theme(out) and "codeLanguages" not in _ui_theme(out)
    assert "--aiui-code-bg" not in (out / "assets" / "theme.css").read_text()


def test_an_unknown_theme_warns_with_the_nearest_name_and_falls_back(tmp_path, themes):
    out, compiler, warnings = _build(tmp_path, code={"light": "min-light", "dark": "dracla"})
    assert _ui_theme(out)["code"] == {"light": "min-light", "dark": "github-dark"}
    issue = next(i for i in compiler.lint_content() if i.code == 7015)
    assert issue.file == "site.theme.code.dark" and "'dracla' is not a bundled code theme" in issue.message
    assert "Did you mean 'dracula'?" in issue.hint
    assert any("dracla" in w for w in warnings)


def test_a_bad_theme_name_is_a_config_error():
    with pytest.raises(ValidationError):
        Config.model_validate({"site": {"title": "A", "theme": {"code": "github dark!"}}})


def test_a_grammar_is_published_with_its_name_aliases_and_base_path(tmp_path, themes):
    out, _, warnings = _build(tmp_path, codeLanguages=["grammars/greet.tmLanguage.json",
                                                       {"source": "grammars/greet.tmLanguage.json", "name": "hi",
                                                        "aliases": ["Salut"]}])
    first, second = _ui_theme(out)["codeLanguages"]
    assert first["name"] == "greet" and first["aliases"] == ["gr"]
    assert first["url"].startswith("/acme/grammars/greet.tmLanguage.json?v=")
    assert second["name"] == "hi" and second["aliases"] == ["salut"]
    assert json.loads((out / "grammars" / "greet.tmLanguage.json").read_text())["scopeName"] == "source.greet"
    assert not warnings


def test_a_missing_or_broken_grammar_is_reported_and_left_out(tmp_path, themes):
    out, compiler, _ = _build(tmp_path, codeLanguages=["grammars/nope.json", "grammars/broken.json"])
    assert "codeLanguages" not in _ui_theme(out)
    assert not (out / "grammars" / "broken.json").exists()
    codes = sorted(i.code for i in compiler.lint_content() if i.file == "site.theme.codeLanguages")
    assert codes == [7014, 7015]


def test_the_frontend_build_lists_every_bundled_theme_with_its_colours():
    known = code_theme.bundled_themes()
    assert {"github-light", "github-dark", "dracula", "nord", "one-dark-pro"} <= set(known)
    assert known["github-dark"]["type"] == "dark" and known["github-dark"]["bg"].startswith("#")
