"""Unit tests for health status utilities."""

import pytest

from praisonaiui.health_utils import SUCCESS_STATUSES, is_success_status


class TestHealthUtils:
    """Test health status utility functions."""

    def test_success_statuses_constant(self):
        """Test SUCCESS_STATUSES contains expected values."""
        assert "ok" in SUCCESS_STATUSES
        assert "healthy" in SUCCESS_STATUSES
        assert len(SUCCESS_STATUSES) == 2

    @pytest.mark.parametrize("status", ["ok", "healthy"])
    def test_is_success_status_with_valid_statuses(self, status):
        """Test is_success_status returns True for valid success statuses."""
        assert is_success_status(status) is True

    @pytest.mark.parametrize("status", ["error", "degraded", "unknown", "failing", ""])
    def test_is_success_status_with_invalid_statuses(self, status):
        """Test is_success_status returns False for invalid statuses."""
        assert is_success_status(status) is False

    def test_is_success_status_with_none(self):
        """Test is_success_status handles None input gracefully."""
        assert is_success_status(None) is False

    def test_is_success_status_case_sensitive(self):
        """Test is_success_status is case sensitive."""
        assert is_success_status("OK") is False
        assert is_success_status("HEALTHY") is False
        assert is_success_status("Ok") is False
        assert is_success_status("Healthy") is False
