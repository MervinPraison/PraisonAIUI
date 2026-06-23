"""Tests for Windows encoding compatibility in CLI output."""

import sys
from unittest import mock

from typer.testing import CliRunner

from praisonaiui.cli import app

runner = CliRunner()


class TestWindowsEncoding:
    """Test suite for Windows cp1252 encoding compatibility."""

    def test_doctor_command_no_unicode_on_windows(self):
        """Ensure doctor command uses ASCII fallbacks on Windows cp1252."""
        # Mock sys.platform as Windows
        with mock.patch("sys.platform", "win32"):
            # Mock stdout encoding as cp1252
            mock_stdout = mock.MagicMock()
            mock_stdout.encoding = "cp1252"

            with mock.patch("sys.stdout", mock_stdout):
                # Run doctor command with mocked server
                with mock.patch("praisonaiui.cli._api_get") as mock_api:
                    mock_api.return_value = {}
                    result = runner.invoke(app, ["doctor", "--server", "http://test:8082"])

                    # Check that output doesn't contain Unicode symbols
                    output = result.stdout
                    assert "✅" not in output
                    assert "❌" not in output
                    assert "⚠️" not in output
                    assert "▶" not in output
                    assert "═" not in output

                    # Check that ASCII fallbacks are present
                    assert "[PASS]" in output or "[WARN]" in output or "[FAIL]" in output
                    assert ">" in output  # Arrow replacement
                    assert "=" in output  # Border replacement

    def test_run_command_no_unicode_on_windows(self):
        """Ensure run command doesn't use Unicode loading spinner on Windows."""
        # Create a minimal test app file
        import os
        import tempfile

        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write("# Test app\n")
            app_file = f.name

        try:
            with mock.patch("sys.platform", "win32"):
                mock_stdout = mock.MagicMock()
                mock_stdout.encoding = "cp1252"

                with mock.patch("sys.stdout", mock_stdout):
                    # Mock the import to prevent actual app execution
                    import importlib.util
                    with mock.patch.object(importlib.util, "spec_from_file_location") as mock_spec:
                        mock_spec.return_value = None

                        result = runner.invoke(app, ["run", app_file, "--port", "8001"])

                        # Check that output doesn't contain Unicode loading spinner
                        output = result.stdout
                        assert "⏳" not in output
        finally:
            os.unlink(app_file)

    def test_utf8_reconfigure_on_windows(self):
        """Test that stdout/stderr are reconfigured to UTF-8 on Windows."""
        # Temporarily reload the module with Windows platform mocked
        import importlib

        with mock.patch("sys.platform", "win32"):
            # Mock the reconfigure methods
            mock_reconfigure = mock.MagicMock()

            with mock.patch.object(sys.stdout, "reconfigure", mock_reconfigure, create=True):
                with mock.patch.object(sys.stderr, "reconfigure", mock_reconfigure, create=True):
                    # Force reload of the cli module to trigger the Windows-specific code
                    from praisonaiui import cli
                    importlib.reload(cli)

                    # Check that reconfigure was called with UTF-8 encoding
                    assert mock_reconfigure.call_count >= 1
                    mock_reconfigure.assert_called_with(encoding="utf-8")

    def test_ascii_fallbacks_in_status_icons(self):
        """Test that status icons use ASCII characters instead of Unicode."""

        # Mock the API call to return test data
        with mock.patch("praisonaiui.cli._api_get") as mock_api:
            mock_api.return_value = {"health": "ok"}

            result = runner.invoke(app, ["doctor", "--server", "http://test:8082"])

            # Verify ASCII representations are used
            output = result.stdout
            # Check that we got the expected ASCII output format
            assert "[PASS]" in output or "[WARN]" in output or "[FAIL]" in output
            # Check for ASCII arrow and border
            assert ">" in output  # Arrow replacement
            assert "=" in output  # Border replacement
