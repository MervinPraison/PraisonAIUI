"""Tests for Windows encoding compatibility in CLI output.

These verify the dynamic ``_icon()`` fallback: rich Unicode symbols are kept on
UTF-aware terminals (macOS/Linux/Windows Terminal) and degrade to ASCII only on
legacy Windows code pages (cp1252/cp437) so output never raises
``UnicodeEncodeError``.
"""

import sys
from unittest import mock

from praisonaiui import cli
from praisonaiui.cli import _icon, _supports_unicode


class TestSupportsUnicode:
    """Detection of UTF-aware terminals."""

    def test_utf8_encoding_is_supported(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = "utf-8"
        with mock.patch("sys.stdout", mock_stdout):
            assert _supports_unicode() is True

    def test_cp1252_encoding_is_not_supported(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = "cp1252"
        with mock.patch("sys.stdout", mock_stdout):
            assert _supports_unicode() is False

    def test_missing_encoding_falls_back_to_ascii(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = None
        with mock.patch("sys.stdout", mock_stdout):
            assert _supports_unicode() is False


class TestIconHelper:
    """The _icon() helper picks symbol vs fallback based on terminal."""

    def test_returns_symbol_on_utf8(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = "utf-8"
        with mock.patch("sys.stdout", mock_stdout):
            assert _icon("✅", "[OK]") == "✅"

    def test_returns_fallback_on_cp1252(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = "cp1252"
        with mock.patch("sys.stdout", mock_stdout):
            assert _icon("✅", "[OK]") == "[OK]"

    def test_fallback_is_pure_ascii(self):
        """Every fallback must be encodable on a legacy code page."""
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = "cp1252"
        with mock.patch("sys.stdout", mock_stdout):
            for symbol, fallback in [
                ("✅", "[PASS]"),
                ("⚠️", "[WARN]"),
                ("❌", "[FAIL]"),
                ("⏳", "..."),
                ("▶", ">"),
                ("═", "="),
            ]:
                result = _icon(symbol, fallback)
                result.encode("cp1252")  # must not raise


class TestUtf8Reconfigure:
    """The module reconfigures stdio to UTF-8 on Windows at import time."""

    def test_utf8_reconfigure_on_windows(self):
        import importlib

        with mock.patch("sys.platform", "win32"):
            mock_reconfigure = mock.MagicMock()
            with mock.patch.object(sys.stdout, "reconfigure", mock_reconfigure, create=True):
                with mock.patch.object(sys.stderr, "reconfigure", mock_reconfigure, create=True):
                    importlib.reload(cli)
                    assert mock_reconfigure.call_count >= 1
                    mock_reconfigure.assert_called_with(encoding="utf-8")

        # Reload once more without the Windows patch so other tests see the
        # real module state.
        importlib.reload(cli)
