"""Tests for the `aiui doctor` CLI command."""
import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

import praisonaiui.cli as cli_mod
from praisonaiui.cli import app

runner = CliRunner()


@pytest.fixture(autouse=True)
def _offline_pypi(monkeypatch):
    """No network in unit tests: PyPI says the installed version is the latest."""
    from praisonaiui import __version__

    monkeypatch.setattr(cli_mod, "_pypi_latest_aiui", lambda timeout=3.0: __version__)


class TestDoctorCLI:
    """Unit tests for the doctor CLI command."""

    def test_doctor_help(self):
        """Doctor command help text is accessible."""
        result = runner.invoke(app, ["doctor", "--help"])
        assert result.exit_code == 0
        assert "diagnostic" in result.output.lower()

    def test_doctor_server_unreachable(self):
        """Doctor handles unreachable server gracefully."""
        result = runner.invoke(app, ["doctor", "--server", "http://localhost:19999"])
        # Should not crash, all checks should show as failed
        assert "fail" in result.output.lower() or "Server Health" in result.output

    def test_doctor_json_output(self):
        """Doctor --json produces valid JSON."""
        result = runner.invoke(
            app, ["doctor", "--server", "http://localhost:19999", "--json"]
        )
        # Parse the JSON output
        data = json.loads(result.output)
        assert "checks" in data
        assert "summary" in data
        assert isinstance(data["checks"], list)
        assert "passed" in data["summary"]
        assert "warnings" in data["summary"]
        assert "failed" in data["summary"]

    def test_doctor_all_checks_present(self):
        """Doctor output includes all 8 checks."""
        result = runner.invoke(app, ["doctor", "--server", "http://localhost:19999"])
        # All checks should appear even if failed
        expected_checks = [
            "aiui Version",
            "Server Health",
            "Provider",
            "Gateway",
            "Features",
            "Config",
            "Datastore",
            "Channels",
        ]
        output_lower = result.output.lower()
        for check in expected_checks:
            assert check.lower() in output_lower, f"Missing check: {check}"

    def test_doctor_json_has_eight_checks(self):
        """Doctor --json returns exactly 8 checks (the version check first)."""
        result = runner.invoke(
            app, ["doctor", "--server", "http://localhost:19999", "--json"]
        )
        data = json.loads(result.output)
        assert len(data["checks"]) == 9, f"Expected 9 checks, got {len(data['checks'])}"

    def test_doctor_summary_counts(self):
        """Doctor --json summary counts are correct."""
        result = runner.invoke(
            app, ["doctor", "--server", "http://localhost:19999", "--json"]
        )
        data = json.loads(result.output)
        summary = data["summary"]
        total = summary["passed"] + summary["warnings"] + summary["failed"]
        assert total == 9, f"Summary counts should total 9, got {total}"

    def test_doctor_check_structure(self):
        """Each check in --json output has required fields."""
        result = runner.invoke(
            app, ["doctor", "--server", "http://localhost:19999", "--json"]
        )
        data = json.loads(result.output)
        for check in data["checks"]:
            assert "name" in check, "Check missing 'name' field"
            assert "status" in check, "Check missing 'status' field"
            assert "detail" in check, "Check missing 'detail' field"
            assert check["status"] in ("pass", "warn", "fail"), f"Invalid status: {check['status']}"


class TestDoctorVersion:
    """``aiui doctor`` says when the installed aiui is older than PyPI's latest."""

    def _version_check(self):
        result = runner.invoke(app, ["doctor", "--server", "http://localhost:19999", "--json"])
        return json.loads(result.output)["checks"][0]

    def test_older_than_pypi_warns_with_the_upgrade_command(self, monkeypatch):
        monkeypatch.setattr(cli_mod, "_pypi_latest_aiui", lambda timeout=3.0: "999.0.0")
        check = self._version_check()
        assert check["name"] == "aiui Version"
        assert check["status"] == "warn"
        assert "999.0.0 on PyPI" in check["detail"]
        assert "uv pip install -U aiui" in check["detail"]

    def test_latest_passes(self):
        assert self._version_check()["status"] == "pass"

    def test_offline_warns_and_does_not_fail(self, monkeypatch):
        monkeypatch.setattr(cli_mod, "_pypi_latest_aiui", lambda timeout=3.0: None)
        check = self._version_check()
        assert check["status"] == "warn"
        assert "could not reach PyPI" in check["detail"]


class TestDoctorInstall:
    """``aiui doctor`` names the version and folder actually imported, and warns
    when pip's metadata disagrees (a stale editable install)."""

    def _install_check(self):
        result = runner.invoke(app, ["doctor", "--server", "http://localhost:19999", "--json"])
        checks = json.loads(result.output)["checks"]
        return next(c for c in checks if c["name"] == "aiui Install")

    def test_matching_metadata_passes_and_names_the_imported_code(self, monkeypatch):
        import praisonaiui
        from praisonaiui import __version__

        monkeypatch.setattr(cli_mod, "_dist_version", lambda: __version__)
        check = self._install_check()
        assert check["status"] == "pass"
        assert __version__ in check["detail"]
        assert str(Path(praisonaiui.__file__).resolve().parent) in check["detail"]

    def test_stale_metadata_warns_with_both_versions(self, monkeypatch):
        from praisonaiui import __version__

        monkeypatch.setattr(cli_mod, "_dist_version", lambda: "0.0.1")
        check = self._install_check()
        assert check["status"] == "warn"
        assert f"{__version__} imported from" in check["detail"]
        assert "metadata says 0.0.1" in check["detail"]
        assert "pip install" in check["detail"]

    def test_no_metadata_warns(self, monkeypatch):
        monkeypatch.setattr(cli_mod, "_dist_version", lambda: None)
        check = self._install_check()
        assert check["status"] == "warn"
        assert "no installed aiui metadata" in check["detail"]

    def test_dist_version_reads_importlib_metadata(self, monkeypatch):
        import importlib.metadata as md

        monkeypatch.setattr(md, "version", lambda name: "1.2.3" if name == "aiui" else None)
        assert cli_mod._dist_version() == "1.2.3"

        def missing(name):
            raise md.PackageNotFoundError(name)

        monkeypatch.setattr(md, "version", missing)
        assert cli_mod._dist_version() is None


class TestDoctorFeatures:
    """``aiui doctor`` reports the live feature count dynamically, never a hardcoded /37 (#635)."""

    def _features_check(self, monkeypatch, payload):
        def fake_api_get(server, path):
            if path == "/api/features":
                return payload
            return {"status": "ok"}

        monkeypatch.setattr(cli_mod, "_api_get", fake_api_get)
        result = runner.invoke(app, ["doctor", "--server", "http://127.0.0.1:8000", "--json"])
        checks = json.loads(result.output)["checks"]
        return next(c for c in checks if c["name"] == "Features Loaded")

    def test_reports_dynamic_registered_count_without_hardcoded_denominator(self, monkeypatch):
        features = [{"name": f"feat_{i}", "status": "ok"} for i in range(49)]
        check = self._features_check(monkeypatch, {"features": features, "count": 49})
        assert check["status"] == "pass"
        assert check["detail"] == "49 features registered"
        assert "/37" not in check["detail"]

    def test_reports_plugin_extended_count(self, monkeypatch):
        features = [{"name": f"feat_{i}", "status": "ok"} for i in range(55)]
        check = self._features_check(monkeypatch, {"features": features, "count": 55})
        assert check["status"] == "pass"
        assert check["detail"] == "55 features registered"

    def test_warns_when_any_feature_is_degraded(self, monkeypatch):
        features = [{"name": f"feat_{i}", "status": "ok"} for i in range(48)] + [
            {"name": "slow_plugin", "status": "timeout"}
        ]
        check = self._features_check(monkeypatch, {"features": features, "count": 49})
        assert check["status"] == "warn"
        assert check["detail"] == "48/49 features healthy (1 degraded)"

    def test_warns_when_zero_features_registered(self, monkeypatch):
        check = self._features_check(monkeypatch, {"features": [], "count": 0})
        assert check["status"] == "warn"
        assert check["detail"] == "0 features registered"
