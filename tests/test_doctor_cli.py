"""Tests for the `aiui doctor` CLI command."""
import json
import pytest
from typer.testing import CliRunner
from praisonaiui.cli import app

runner = CliRunner()


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
        """Doctor output includes all 7 checks."""
        result = runner.invoke(app, ["doctor", "--server", "http://localhost:19999"])
        # All checks should appear even if failed
        expected_checks = [
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

    def test_doctor_json_has_seven_checks(self):
        """Doctor --json returns exactly 7 checks."""
        result = runner.invoke(
            app, ["doctor", "--server", "http://localhost:19999", "--json"]
        )
        data = json.loads(result.output)
        assert len(data["checks"]) == 7, f"Expected 7 checks, got {len(data['checks'])}"

    def test_doctor_summary_counts(self):
        """Doctor --json summary counts are correct."""
        result = runner.invoke(
            app, ["doctor", "--server", "http://localhost:19999", "--json"]
        )
        data = json.loads(result.output)
        summary = data["summary"]
        total = summary["passed"] + summary["warnings"] + summary["failed"]
        assert total == 7, f"Summary counts should total 7, got {total}"

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
