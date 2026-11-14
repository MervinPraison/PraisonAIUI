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


def test_plugin_registry_exports_are_lazy_and_resolve():
    """The app-shell plugin API is exported from the package root without
    importing plugin_registry at ``import praisonaiui`` time."""
    import subprocess
    import sys

    code = (
        "import sys, praisonaiui as a\n"
        "assert 'praisonaiui.plugin_registry' not in sys.modules\n"
        "from praisonaiui import plugin_registry as r\n"
        "for n in ('register_plugin','set_extensions','PageSpec','BlockSpec','ToolRendererSpec'):\n"
        "    assert n in a.__all__, n\n"
        "    assert getattr(a, n) is getattr(r, n), n\n"
    )
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
