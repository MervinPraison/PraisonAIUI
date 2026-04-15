"""Tests for feature registry graceful degradation.

Verifies that auto_register_defaults() continues registering features
even when individual feature modules fail to import.
"""

import importlib
from unittest import mock

from praisonaiui.features import (
    _features,
    auto_register_defaults,
    get_features,
)


class TestAutoRegisterGracefulDegradation:
    """Prove that a broken feature module doesn't block the rest."""

    def test_partial_failure_still_registers_others(self):
        """If one feature import fails, the rest still register."""
        # Clear registry
        _features.clear()

        # Patch importlib.import_module to fail for ONE specific module
        _real_import = importlib.import_module

        def _patched_import(name, package=None):
            if name == ".agents" and package and "features" in package:
                raise ImportError("Simulated broken agents module")
            return _real_import(name, package=package)

        with mock.patch(
            "importlib.import_module",
            side_effect=_patched_import,
        ):
            auto_register_defaults()

        features = get_features()
        # agents should be missing
        assert "agents_crud" not in features
        # but other features should be registered (at least chat, theme, memory)
        assert len(features) >= 10, f"Only {len(features)} features registered"
        assert "chat" in features
        assert "theme" in features
