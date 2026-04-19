"""Tests for the component registry extensibility in dashboard.js.

Verifies:
  1. COMPONENT_REGISTRY object exists
  2. window.aiui.registerComponent() API exists
  3. renderComponent() checks COMPONENT_REGISTRY before hardcoded switch
  4. All Python ui.py component types have a matching JS renderer case
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

# Path to dashboard.js
DASHBOARD_JS = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "dashboard.js"
)


@pytest.fixture
def dashboard_source():
    """Read dashboard.js source."""
    return DASHBOARD_JS.read_text()


class TestComponentRegistry:
    """Verify the extensible component registry exists."""

    def test_component_registry_object_exists(self, dashboard_source):
        assert "COMPONENT_REGISTRY" in dashboard_source

    def test_register_component_api_exists(self, dashboard_source):
        assert "registerComponent" in dashboard_source

    def test_register_component_is_on_window_aiui(self, dashboard_source):
        assert "window.aiui.registerComponent" in dashboard_source

    def test_render_component_checks_registry_first(self, dashboard_source):
        """renderComponent() must check COMPONENT_REGISTRY before the switch."""
        # Find the renderComponent function
        match = re.search(
            r"function renderComponent\(comp\)\s*\{(.*?)^}",
            dashboard_source,
            re.DOTALL | re.MULTILINE,
        )
        assert match, "renderComponent function not found"
        body = match.group(1)

        # Registry check must come before the switch
        registry_pos = body.find("COMPONENT_REGISTRY")
        switch_pos = body.find("switch")
        assert registry_pos != -1, "COMPONENT_REGISTRY not referenced in renderComponent"
        assert registry_pos < switch_pos, (
            "COMPONENT_REGISTRY check must come BEFORE the switch statement"
        )


class TestPythonJSComponentParity:
    """Every Python component type in ui.py must have a JS renderer."""

    def test_all_python_types_have_js_case(self, dashboard_source):
        """Extract all type strings from ui.py and verify each has a case in dashboard.js."""
        ui_py = (
            Path(__file__).resolve().parents[2]
            / "src" / "praisonaiui" / "ui.py"
        )
        source = ui_py.read_text()

        # Extract all "type": "xxx" patterns from ui.py
        py_types = set(re.findall(r'"type":\s*"(\w+)"', source))
        assert len(py_types) > 40, f"Expected 40+ component types, got {len(py_types)}"

        # Extract all case 'xxx': patterns from dashboard.js renderComponent switch
        js_cases = set(re.findall(r"case\s+'(\w+)'", dashboard_source))

        missing = py_types - js_cases
        assert not missing, (
            f"Python component types missing JS renderer: {sorted(missing)}"
        )

    def test_form_action_type_has_js_case(self, dashboard_source):
        """The form_action component must have a JS renderer."""
        assert "case 'form_action'" in dashboard_source
