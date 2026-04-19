"""Test that every symbol in praisonaiui.__all__ is importable."""

from __future__ import annotations

import importlib


def test_all_exports_importable():
    """Every name in __all__ must be accessible via getattr."""
    mod = importlib.import_module("praisonaiui")
    missing = []
    for name in mod.__all__:
        try:
            getattr(mod, name)
        except (AttributeError, ImportError) as e:
            missing.append((name, str(e)))
    assert not missing, f"Failed to import: {missing}"


def test_all_exports_count():
    """Sanity check — __all__ should have 80+ symbols."""
    mod = importlib.import_module("praisonaiui")
    assert len(mod.__all__) >= 80, f"Only {len(mod.__all__)} exports"
