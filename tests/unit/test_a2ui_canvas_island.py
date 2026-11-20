"""The dashboard canvas loads the official catalog, and can still fall back."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SURFACE = ROOT / "src/praisonaiui/templates/frontend/plugins/surface-utils.js"
ISLAND = ROOT / "src/praisonaiui/templates/frontend/assets/a2ui-island.js"


def test_canvas_tries_official_catalog_then_the_small_mapper():
    text = SURFACE.read_text(encoding="utf-8")
    assert "import('/assets/a2ui-island.js')" in text
    assert "a2ui-mapper.js" in text
    assert "mountA2ui" in text


def test_shipped_island_exports_the_canvas_mount():
    bundle = ISLAND.read_text(encoding="utf-8")
    assert "mountA2ui" in bundle
    assert "TextField" in bundle
