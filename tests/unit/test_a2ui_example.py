"""Smoke test for Example 30 (A2UI Canvas, Settings & Action handlers)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def _load_example30():
    path = (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "python"
        / "30-a2ui-canvas"
        / "app.py"
    )
    spec = importlib.util.spec_from_file_location("example30_a2ui", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.asyncio
async def test_a2ui_example_pages_and_actions():
    mod = _load_example30()

    canvas = await mod.agent_canvas_page()
    assert "_surface" in canvas
    assert canvas["_surface"]["id"] == "main"

    settings = await mod.a2ui_settings_page()
    assert "_components" in settings
    assert len(settings["_components"]) >= 4

    res = await mod.on_surface_action({"action": "increment"})
    assert res["counter"] >= 2
