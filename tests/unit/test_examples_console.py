"""Tests for the shared examples console helper.

These verify that examples degrade emoji to ASCII on legacy Windows code pages
(cp1252) instead of raising ``UnicodeEncodeError`` while preserving emoji on
UTF-aware terminals, mirroring the CLI ``_icon``/``_supports_unicode`` pattern.
"""

import io
import os
import sys
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "examples", "python", "_shared"))
from console import icon, safe_print, supports_unicode


class TestSupportsUnicode:
    def test_utf8_encoding_is_supported(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = "utf-8"
        with mock.patch("sys.stdout", mock_stdout):
            assert supports_unicode() is True

    def test_cp1252_encoding_is_not_supported(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = "cp1252"
        with mock.patch("sys.stdout", mock_stdout):
            assert supports_unicode() is False

    def test_missing_encoding_falls_back_to_ascii(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = None
        with mock.patch("sys.stdout", mock_stdout):
            assert supports_unicode() is False


class TestIcon:
    def test_returns_symbol_on_utf8(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = "utf-8"
        with mock.patch("sys.stdout", mock_stdout):
            assert icon("🚀", "[START]") == "🚀"

    def test_returns_fallback_on_cp1252(self):
        mock_stdout = mock.MagicMock()
        mock_stdout.encoding = "cp1252"
        with mock.patch("sys.stdout", mock_stdout):
            assert icon("🚀", "[START]") == "[START]"


class TestSafePrint:
    def test_never_raises_on_cp1252(self):
        buffer = io.BytesIO()
        stream = io.TextIOWrapper(buffer, encoding="cp1252", errors="strict")
        with mock.patch("sys.stdout", stream):
            safe_print("🚀 Starting")
            stream.flush()
        assert buffer.getvalue()

    def test_preserves_unicode_on_utf8(self):
        buffer = io.StringIO()
        with mock.patch("sys.stdout", buffer):
            safe_print("🚀 Starting")
        assert "🚀" in buffer.getvalue()

    def test_respects_sep(self):
        buffer = io.StringIO()
        with mock.patch("sys.stdout", buffer):
            safe_print("a", "b", sep="-")
        assert buffer.getvalue().strip() == "a-b"
