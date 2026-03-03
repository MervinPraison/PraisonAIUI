"""Integration tests for CLI commands — validate → build → serve pipeline."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from typer.testing import CliRunner

from praisonaiui.cli import app

runner = CliRunner()


@pytest.fixture
def project_dir(tmp_path: Path) -> Path:
    """Create a minimal project directory with config and docs."""
    config = tmp_path / "aiui.template.yaml"
    config.write_text(
        """\
schemaVersion: 1
site:
  title: "Integration Test Site"
  description: "A site for integration testing"

components:
  header_main:
    type: Header
    props:
      logoText: IntegrationTest

  footer_main:
    type: Footer
    props:
      text: "© 2026 Test"

templates:
  docs:
    layout: ThreeColumnLayout
    slots:
      header:
        ref: header_main
      footer:
        ref: footer_main
      main:
        type: DocContent

routes:
  - match: "/docs/**"
    template: docs
"""
    )

    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "index.md").write_text("# Welcome\n\nHello from integration test.")
    (docs_dir / "guide.md").write_text("# Guide\n\nA test guide.")

    return tmp_path


class TestValidateCommand:
    """Tests for the `aiui validate` command."""

    def test_validate_valid_config(self, project_dir: Path):
        result = runner.invoke(app, ["validate", "--config", str(project_dir / "aiui.template.yaml")])
        assert result.exit_code == 0
        assert "valid" in result.stdout.lower() or "✅" in result.stdout or "✓" in result.stdout

    def test_validate_missing_config(self, tmp_path: Path):
        result = runner.invoke(app, ["validate", "--config", str(tmp_path / "nonexistent.yaml")])
        assert result.exit_code != 0


class TestBuildCommand:
    """Tests for the `aiui build` command."""

    def test_build_creates_output(self, project_dir: Path):
        output = project_dir / "aiui-output"
        result = runner.invoke(
            app,
            ["build", "--config", str(project_dir / "aiui.template.yaml"), "--output", str(output)],
        )
        assert result.exit_code == 0
        assert output.exists()
        assert (output / "ui-config.json").exists()
        assert (output / "route-manifest.json").exists()

    def test_build_ui_config_content(self, project_dir: Path):
        output = project_dir / "aiui-output"
        runner.invoke(
            app,
            ["build", "--config", str(project_dir / "aiui.template.yaml"), "--output", str(output)],
        )

        ui_config = json.loads((output / "ui-config.json").read_text())
        assert ui_config["site"]["title"] == "Integration Test Site"
        assert "header_main" in ui_config["components"]
        assert "footer_main" in ui_config["components"]

    def test_build_with_minify(self, project_dir: Path):
        output = project_dir / "aiui-output"
        runner.invoke(
            app,
            [
                "build",
                "--config", str(project_dir / "aiui.template.yaml"),
                "--output", str(output),
                "--minify",
            ],
        )

        content = (output / "ui-config.json").read_text()
        assert "\n" not in content  # Minified = no newlines

    def test_build_invalid_config(self, tmp_path: Path):
        config = tmp_path / "bad.yaml"
        config.write_text("not: valid: yaml: config")
        result = runner.invoke(
            app,
            ["build", "--config", str(config), "--output", str(tmp_path / "out")],
        )
        assert result.exit_code != 0

    def test_build_broken_ref(self, tmp_path: Path):
        config = tmp_path / "broken.yaml"
        config.write_text(
            """\
schemaVersion: 1
site:
  title: Broken

templates:
  docs:
    layout: Default
    slots:
      header:
        ref: does_not_exist

routes:
  - match: "/docs/**"
    template: docs
"""
        )
        result = runner.invoke(
            app,
            ["build", "--config", str(config), "--output", str(tmp_path / "out")],
        )
        assert result.exit_code != 0 or "does_not_exist" in result.stdout


class TestServeCommand:
    """Tests for the `aiui serve` command."""

    def test_serve_missing_output(self, tmp_path: Path):
        """Serve should fail if output dir doesn't exist and --no-build."""
        result = runner.invoke(
            app,
            [
                "serve",
                "--config", str(tmp_path / "aiui.template.yaml"),
                "--output", str(tmp_path / "nonexistent"),
                "--no-build",
            ],
        )
        assert result.exit_code == 2

    def test_serve_help(self):
        """Serve --help should describe all options."""
        result = runner.invoke(app, ["serve", "--help"])
        assert result.exit_code == 0
        assert "--host" in result.stdout
        assert "--cors-origins" in result.stdout
        assert "--watch" in result.stdout
        assert "--no-build" in result.stdout


class TestInitCommand:
    """Tests for the `aiui init` command."""

    def test_init_help(self):
        result = runner.invoke(app, ["init", "--help"])
        assert result.exit_code == 0
        assert "init" in result.stdout.lower() or "Initialize" in result.stdout


class TestFullPipeline:
    """End-to-end: validate → build → verify output."""

    def test_validate_then_build(self, project_dir: Path):
        output = project_dir / "full-pipeline"

        # Validate
        val_result = runner.invoke(
            app,
            ["validate", "--config", str(project_dir / "aiui.template.yaml")],
        )
        assert val_result.exit_code == 0

        # Build
        build_result = runner.invoke(
            app,
            [
                "build",
                "--config", str(project_dir / "aiui.template.yaml"),
                "--output", str(output),
            ],
        )
        assert build_result.exit_code == 0

        # Verify output structure
        assert (output / "ui-config.json").exists()
        assert (output / "route-manifest.json").exists()
        assert (output / "index.html").exists()

        # Verify content
        ui_config = json.loads((output / "ui-config.json").read_text())
        assert ui_config["site"]["title"] == "Integration Test Site"

        routes = json.loads((output / "route-manifest.json").read_text())
        assert len(routes["routes"]) >= 1
