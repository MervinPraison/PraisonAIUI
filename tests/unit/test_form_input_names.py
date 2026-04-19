"""Tests for the `name=` kwarg on form input components.

Closes the gap: previously, form_action used input labels as dict keys, which
collides when the same label is used twice. With `name=`, users can give each
input an explicit, stable key.

Priority (highest first):
    1. name (explicit)
    2. label (fallback)
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from praisonaiui.ui import (
    checkbox_input,
    number_input,
    radio_input,
    select_input,
    slider_input,
    switch_input,
    text_input,
    textarea_input,
)


# ── Python dict shape ─────────────────────────────────────────────

class TestInputNameKwarg:
    """Every form input must accept `name=` and emit it in the dict."""

    def test_text_input_accepts_name(self):
        c = text_input("Email", name="user_email")
        assert c["name"] == "user_email"

    def test_number_input_accepts_name(self):
        c = number_input("Age", name="user_age", value=0)
        assert c["name"] == "user_age"

    def test_select_input_accepts_name(self):
        c = select_input("Role", options=["a", "b"], name="user_role")
        assert c["name"] == "user_role"

    def test_slider_input_accepts_name(self):
        c = slider_input("Volume", name="vol")
        assert c["name"] == "vol"

    def test_checkbox_input_accepts_name(self):
        c = checkbox_input("Subscribe", name="subscribe")
        assert c["name"] == "subscribe"

    def test_switch_input_accepts_name(self):
        c = switch_input("Enabled", name="enabled")
        assert c["name"] == "enabled"

    def test_radio_input_accepts_name(self):
        c = radio_input("Plan", options=["a", "b"], name="plan")
        assert c["name"] == "plan"

    def test_textarea_input_accepts_name(self):
        c = textarea_input("Notes", name="notes")
        assert c["name"] == "notes"

    def test_name_is_optional_default_unset(self):
        """When name isn't given, the dict must NOT contain 'name'."""
        c = text_input("Email")
        assert "name" not in c


# ── JS renderer emits `name` attribute ────────────────────────────

DASHBOARD_JS = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend"
    / "plugins" / "dashboard.js"
)


class TestRenderersEmitName:
    """JS renderers must emit `name="..."` so that form_action picks it up
    via `el.name` (which has priority over `el.dataset.label`)."""

    def _src(self):
        return DASHBOARD_JS.read_text()

    @pytest.mark.parametrize("renderer", [
        "renderTextInput",
        "renderNumberInput",
        "renderSelectInput",
        "renderSliderInput",
        "renderCheckboxInput",
        "renderSwitchInput",
        "renderRadioInput",
        "renderTextareaInput",
    ])
    def test_renderer_uses_name_attr(self, renderer):
        source = self._src()
        m = re.search(
            rf"function {renderer}\(comp\)\s*\{{(.*?)^}}",
            source, re.DOTALL | re.MULTILINE,
        )
        assert m, f"{renderer} not found"
        body = m.group(1)
        # Renderer must reference comp.name (so it can emit name="..." attr)
        assert "comp.name" in body, (
            f"{renderer} must read comp.name so form_action can collect its "
            f"value via el.name (which takes priority over data-label)"
        )


# ── form_action submit-handler priority order ─────────────────────

class TestSubmitCollectorPriority:
    """renderFormAction submit handler must prefer `name` over `data-label`."""

    def test_name_has_priority_over_label(self):
        source = DASHBOARD_JS.read_text()
        m = re.search(
            r"function renderFormAction\(comp\)\s*\{(.*?)^}",
            source, re.DOTALL | re.MULTILINE,
        )
        assert m
        body = m.group(1)
        # The key assignment should be: `el.name || el.dataset.label || ...`
        assert "el.name" in body
        assert "dataset.label" in body
        # Ensure el.name comes before dataset.label in the fallback chain
        name_idx = body.find("el.name")
        label_idx = body.find("dataset.label")
        assert name_idx < label_idx, (
            "el.name must come BEFORE el.dataset.label in the key fallback "
            "chain so explicit names take priority"
        )
