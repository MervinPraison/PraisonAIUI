"""Unit tests for ADP JSON Schema validation."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, ValidationError

ADP_ROOT = Path(__file__).resolve().parents[2] / "docs" / "protocols" / "adp"
SCHEMA_DIR = ADP_ROOT / "schema"
EXAMPLES_DIR = ADP_ROOT / "examples"
CATALOGS_DIR = ADP_ROOT / "catalogs"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def _load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text())


def _application_validator() -> Draft202012Validator:
    schema = _load_json(SCHEMA_DIR / "application.schema.json")
    return Draft202012Validator(schema)


def _catalog_validator() -> Draft202012Validator:
    schema = _load_json(SCHEMA_DIR / "component-catalog.schema.json")
    return Draft202012Validator(schema)


def _theme_validator() -> Draft202012Validator:
    schema = _load_json(SCHEMA_DIR / "theme.schema.json")
    return Draft202012Validator(schema)


@pytest.mark.parametrize(
    "schema_path",
    [
        SCHEMA_DIR / "application.schema.json",
        SCHEMA_DIR / "component-catalog.schema.json",
        SCHEMA_DIR / "theme.schema.json",
    ],
)
def test_schema_files_are_valid_meta_schema(schema_path: Path) -> None:
    schema = _load_json(schema_path)
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize(
    "example_name",
    ["minimal.application.yaml", "docs-site.application.yaml", "landing-page.application.yaml"],
)
def test_examples_validate_against_application_schema(example_name: str) -> None:
    doc = _load_yaml(EXAMPLES_DIR / example_name)
    _application_validator().validate(doc)


def test_default_catalog_validates_against_catalog_schema() -> None:
    catalog = _load_json(CATALOGS_DIR / "default.catalog.json")
    _catalog_validator().validate(catalog)


def test_theme_mutual_exclusion_r27() -> None:
    with pytest.raises(ValidationError):
        _theme_validator().validate({"preset": "zinc", "tokens": "./tokens.json"})


def test_theme_preset_only_valid() -> None:
    _theme_validator().validate({"preset": "zinc", "radius": "md", "darkMode": True})


def test_x_adp_extension_accepted_at_root() -> None:
    doc = _load_yaml(EXAMPLES_DIR / "minimal.application.yaml")
    doc["x-adp-custom"] = True
    _application_validator().validate(doc)


def test_template_requires_slots_or_zones() -> None:
    doc = _load_yaml(EXAMPLES_DIR / "minimal.application.yaml")
    doc["spec"]["templates"]["docs"] = {"layout": "TwoColumnLayout"}
    with pytest.raises(ValidationError):
        _application_validator().validate(doc)
