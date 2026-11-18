"""``$ref`` config splitting (schema/loader.py) and the aiui.yaml JSON Schema."""

from __future__ import annotations

import json

import pytest
import yaml
from typer.testing import CliRunner

from praisonaiui.cli import app as cli_app
from praisonaiui.schema.loader import (
    SCHEMA_URL,
    ConfigLoadError,
    config_json_schema,
    load_config_file,
    source_of,
)
from praisonaiui.schema.models import Config


def _write(root, files: dict[str, str]):
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return root / "aiui.yaml"


def test_ref_replaces_the_mapping_relative_to_its_file(tmp_path):
    cfg = _write(tmp_path, {
        "aiui.yaml": "site:\n  title: T\nnavigation:\n  $ref: ./conf/nav.yaml\n",
        "conf/nav.yaml": "pages: [intro]\ngroups:\n  - $ref: groups/one.yaml\n",
        "conf/groups/one.yaml": "group: One\npages: [a, b]\n",
    })
    sources: dict = {}
    data = load_config_file(cfg, sources)
    assert data["navigation"] == {"pages": ["intro"], "groups": [{"group": "One", "pages": ["a", "b"]}]}
    assert Config.model_validate(data).navigation.groups[0].group == "One"
    assert source_of(("navigation", "groups", 0, "pages"), sources) == "conf/groups/one.yaml"
    assert source_of(("navigation", "pages"), sources) == "conf/nav.yaml"
    assert source_of(("site", "title"), sources) is None


def test_keys_beside_ref_override_the_included_mapping(tmp_path):
    cfg = _write(tmp_path, {
        "aiui.yaml": "site:\n  $ref: site.yaml\n  title: Mine\n",
        "site.yaml": "title: Shared\ndescription: D\n",
    })
    assert load_config_file(cfg)["site"] == {"title": "Mine", "description": "D"}


def test_ref_can_include_a_list(tmp_path):
    cfg = _write(tmp_path, {"aiui.yaml": "routes:\n  $ref: routes.yaml\n", "routes.yaml": "- {match: /a, template: t}\n"})
    assert load_config_file(cfg)["routes"] == [{"match": "/a", "template": "t"}]


def test_missing_file_names_the_including_file_and_line(tmp_path):
    cfg = _write(tmp_path, {"aiui.yaml": "site:\n  title: T\nnavigation:\n  $ref: nav.yaml\n"})
    with pytest.raises(ConfigLoadError) as err:
        load_config_file(cfg)
    assert (err.value.file, err.value.line) == ("aiui.yaml", 4)
    assert "'nav.yaml' not found" in str(err.value)


def test_cycle_is_an_error(tmp_path):
    cfg = _write(tmp_path, {
        "aiui.yaml": "navigation:\n  $ref: a.yaml\n",
        "a.yaml": "pages:\n  $ref: b.yaml\n",
        "b.yaml": "$ref: a.yaml\n",
    })
    with pytest.raises(ConfigLoadError, match=r"cycle: a.yaml -> b.yaml -> a.yaml") as err:
        load_config_file(cfg)
    assert err.value.file == "b.yaml"


def test_ref_outside_the_project_folder_is_refused(tmp_path):
    (tmp_path / "secret.yaml").write_text("x: 1\n", encoding="utf-8")
    cfg = _write(tmp_path / "site", {"aiui.yaml": "navigation:\n  $ref: ../secret.yaml\n"})
    with pytest.raises(ConfigLoadError, match="outside the project folder"):
        load_config_file(cfg)


def test_yaml_error_in_an_included_file_names_that_file(tmp_path):
    cfg = _write(tmp_path, {"aiui.yaml": "navigation:\n  $ref: nav.yaml\n", "nav.yaml": "pages: [a\n"})
    with pytest.raises(yaml.YAMLError, match="nav.yaml"):
        load_config_file(cfg)


def test_a_config_without_ref_loads_like_safe_load(tmp_path):
    text = "site:\n  title: T\nlist: [1, {a: 2}]\n"
    cfg = _write(tmp_path, {"aiui.yaml": text})
    assert load_config_file(cfg) == yaml.safe_load(text)


def test_validate_and_build_follow_ref(tmp_path, monkeypatch):
    cfg = _write(tmp_path, {
        "aiui.yaml": "site:\n  title: T\ncontent:\n  docs:\n    dir: ./docs\nnavigation:\n  $ref: nav.yaml\n",
        "nav.yaml": "pages: [index]\nbogus: 1\n",
        "docs/index.md": "# Home\n\nHello.\n",
    })
    result = CliRunner().invoke(cli_app, ["validate", "-c", str(cfg)])
    assert result.exit_code == 0, result.output
    assert "nav.yaml: Unknown key 'navigation.bogus'" in result.output
    out = tmp_path / "out"
    result = CliRunner().invoke(cli_app, ["build", "-c", str(cfg), "-o", str(out)])
    assert result.exit_code == 0, result.output


def test_validate_reports_a_broken_ref(tmp_path):
    cfg = _write(tmp_path, {"aiui.yaml": "site:\n  title: T\nnavigation:\n  $ref: gone.yaml\n"})
    result = CliRunner().invoke(cli_app, ["validate", "-c", str(cfg)])
    assert result.exit_code == 1
    assert "aiui.yaml:4: $ref 'gone.yaml' not found" in result.output


def test_schema_command_prints_the_config_schema(tmp_path):
    result = CliRunner().invoke(cli_app, ["schema"])
    assert result.exit_code == 0, result.output
    schema = json.loads(result.output)
    assert schema == config_json_schema()
    assert schema["$id"] == SCHEMA_URL
    assert {"site", "navigation", "content"} <= set(schema["properties"])
    out = tmp_path / "aiui.schema.json"
    assert CliRunner().invoke(cli_app, ["schema", "-o", str(out)]).exit_code == 0
    assert json.loads(out.read_text(encoding="utf-8")) == schema


def test_init_writes_the_schema_modeline(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert CliRunner().invoke(cli_app, ["init"]).exit_code == 0
    first = (tmp_path / "aiui.yaml").read_text(encoding="utf-8").splitlines()[0]
    assert first == f"# yaml-language-server: $schema={SCHEMA_URL}"
    assert Config.model_validate(load_config_file(tmp_path / "aiui.yaml")).site.title
