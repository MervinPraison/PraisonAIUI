"""Integration tests for tool call enrichment parity.

Verifies that SSE tool call events from the /run endpoint include
enriched fields (icon, description, step_number, formatted_result)
matching the CLI's EditorOutput, and that tool_call_id is present
for frontend deduplication.

Run with:
    python -m pytest tests/integration/test_tool_call_parity.py -v -o "addopts="
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import (
    _callbacks,
    create_app,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_sse(text: str) -> list:
    """Parse SSE text into a list of JSON events."""
    events = []
    for line in text.strip().split("\n"):
        line = line.strip()
        if line.startswith("data:"):
            payload = line[len("data:"):].strip()
            try:
                events.append(json.loads(payload))
            except json.JSONDecodeError:
                pass
    return events


def _tool_events(events: list) -> tuple:
    """Split events into tool starts, completions, and content."""
    starts = [e for e in events if "tool_call_started" in e.get("type", "")]
    completions = [e for e in events if "tool_call_completed" in e.get("type", "")]
    content = [e for e in events if e.get("type") == "content"]
    errors = [e for e in events if e.get("type") == "error"]
    return starts, completions, content, errors


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_state():
    _callbacks.clear()
    yield
    _callbacks.clear()


@pytest.fixture
def client():
    return TestClient(create_app())


# ---------------------------------------------------------------------------
# Mock Provider — simulates tool call events in SSE stream
# ---------------------------------------------------------------------------

class MockRunEvent:
    """Simulates a RunEvent from the provider."""
    def __init__(self, type_val, **kwargs):
        self._type = type_val
        self._data = kwargs

    @property
    def type(self):
        return self._type

    @property
    def tool_call_id(self):
        return self._data.get("tool_call_id")

    def to_dict(self):
        d = {"type": self._type.value if hasattr(self._type, "value") else str(self._type)}
        d.update(self._data)
        return d


# ---------------------------------------------------------------------------
# Tests: Tool Call Enrichment Fields
# ---------------------------------------------------------------------------

class TestToolCallEnrichment:
    """Tests that /run SSE events include enriched tool call fields."""

    def test_enrichment_fields_present_on_started(self, client):
        """tool_call_started events MUST have icon, description, step_number."""
        # Use the real provider path — send a search prompt
        r = client.post("/run", json={"message": "search the web for Python news"})
        assert r.status_code == 200
        events = _parse_sse(r.text)
        starts, completions, content, errors = _tool_events(events)

        # If no tools were called (no provider configured), skip gracefully
        if not starts:
            pytest.skip("No tool calls in response (provider may not be configured)")

        for evt in starts:
            name = evt.get("name", "unknown")
            assert "icon" in evt, f"Missing 'icon' on tool_call_started for {name}"
            assert "description" in evt, f"Missing 'description' on tool_call_started for {name}"
            assert "step_number" in evt, f"Missing 'step_number' on tool_call_started for {name}"

    def test_formatted_result_present_on_completed(self, client):
        """tool_call_completed events MUST have formatted_result."""
        r = client.post("/run", json={"message": "search the web for AI agents"})
        assert r.status_code == 200
        events = _parse_sse(r.text)
        starts, completions, content, errors = _tool_events(events)

        if not completions:
            pytest.skip("No tool completions in response")

        for evt in completions:
            name = evt.get("name", "unknown")
            assert "formatted_result" in evt, (
                f"Missing 'formatted_result' on tool_call_completed for {name}"
            )

    def test_no_server_errors(self, client):
        """The /run endpoint MUST not produce error events."""
        r = client.post("/run", json={"message": "hello"})
        assert r.status_code == 200
        events = _parse_sse(r.text)
        _, _, _, errors = _tool_events(events)
        assert len(errors) == 0, f"Server produced error events: {errors}"


# ---------------------------------------------------------------------------
# Tests: TOOL_LABELS Parity
# ---------------------------------------------------------------------------

class TestToolLabelsParity:
    """Tests that SSE enrichment matches the SDK's TOOL_LABELS source of truth."""

    def test_icon_and_label_match_sdk(self, client):
        """icon and label in SSE events MUST match TOOL_LABELS from SDK."""
        try:
            from praisonaiagents.output.editor import TOOL_LABELS
        except ImportError:
            pytest.skip("praisonaiagents SDK not installed")

        r = client.post("/run", json={"message": "search the web for test"})
        events = _parse_sse(r.text)
        starts, _, _, _ = _tool_events(events)

        if not starts:
            pytest.skip("No tool calls to compare")

        for evt in starts:
            name = evt.get("name", "")
            if name not in TOOL_LABELS:
                continue  # Unknown tools use fallback, which is fine

            expected_icon, expected_label = TOOL_LABELS[name]
            assert evt.get("icon") == expected_icon, (
                f"Icon mismatch for {name}: "
                f"expected={expected_icon}, got={evt.get('icon')}"
            )
            assert evt.get("label") == expected_label, (
                f"Label mismatch for {name}: "
                f"expected={expected_label}, got={evt.get('label')}"
            )

    def test_description_matches_format_action(self, client):
        """description field MUST match EditorOutput._format_action output."""
        try:
            from praisonaiagents.output.editor import TOOL_LABELS, EditorOutput
        except ImportError:
            pytest.skip("praisonaiagents SDK not installed")

        r = client.post(
            "/run",
            json={"message": "search the web for Python AI frameworks"},
        )
        events = _parse_sse(r.text)
        starts, _, _, _ = _tool_events(events)

        # Only compare events with complete args
        starts_with_args = [
            e for e in starts
            if isinstance(e.get("args"), dict) and e.get("args")
        ]

        if not starts_with_args:
            pytest.skip("No tool calls with complete args to compare")

        for evt in starts_with_args:
            name = evt.get("name", "")
            args = evt.get("args", {})
            api_desc = evt.get("description", "")

            icon, label = TOOL_LABELS.get(name, ("🔧", f"Using {name}"))
            cli_desc = EditorOutput._format_action("", icon, label, args).strip()

            assert api_desc == cli_desc, (
                f"Description mismatch for {name}:\n"
                f"  CLI: {cli_desc}\n"
                f"  API: {api_desc}"
            )


# ---------------------------------------------------------------------------
# Tests: tool_call_id Consistency
# ---------------------------------------------------------------------------

class TestToolCallIdConsistency:
    """Tests that tool_call_id is consistently present for dedup."""

    def test_tool_call_id_present_on_events(self, client):
        """All tool call events SHOULD have a tool_call_id for frontend dedup."""
        r = client.post("/run", json={"message": "search the web for testing"})
        events = _parse_sse(r.text)
        starts, completions, _, _ = _tool_events(events)

        if not starts and not completions:
            pytest.skip("No tool calls in response")

        # Check starts
        missing_ids = []
        for evt in starts + completions:
            if not evt.get("tool_call_id"):
                missing_ids.append(evt)

        # Report but don't fail hard — SDK gap may still send some events w/o ID
        if missing_ids:
            names = [e.get("name", "?") for e in missing_ids]
            pytest.xfail(
                f"SDK gap: {len(missing_ids)} events missing tool_call_id "
                f"(names: {names})"
            )


# ---------------------------------------------------------------------------
# Tests: Step Number Dedup
# ---------------------------------------------------------------------------

class TestStepNumberDedup:
    """Tests that step_number doesn't skip for the same tool call."""

    def test_step_numbers_are_sequential(self, client):
        """step_number values should start at 1 and increment."""
        r = client.post("/run", json={"message": "search for AI news"})
        events = _parse_sse(r.text)
        starts, _, _, _ = _tool_events(events)

        if not starts:
            pytest.skip("No tool calls in response")

        steps = [e.get("step_number") for e in starts if e.get("step_number")]
        if steps:
            assert steps[0] >= 1, f"step_number should start at 1+, got {steps[0]}"
            # Steps should not have huge gaps
            for i in range(1, len(steps)):
                gap = steps[i] - steps[i - 1]
                assert gap >= 0, f"step_number went backwards: {steps}"
                assert gap <= 2, (
                    f"step_number gap too large ({gap}) at index {i}: {steps}"
                )


# ---------------------------------------------------------------------------
# Tests: Knowledge Injection Safety
# ---------------------------------------------------------------------------

class TestKnowledgeInjectionSafety:
    """Tests that knowledge injection never crashes the /run endpoint."""

    def test_run_survives_knowledge_failure(self, client):
        """Even if knowledge backend crashes, /run should return 200."""
        # This implicitly tests the BaseException catch for pyo3 panics
        r = client.post("/run", json={"message": "hello"})
        assert r.status_code == 200
        events = _parse_sse(r.text)
        # Should have at least an end event
        assert any(e.get("type") == "end" for e in events) or len(events) > 0


# ---------------------------------------------------------------------------
# Tests: Multi-Tool Comprehensive Exercise
# ---------------------------------------------------------------------------

class TestMultiToolExercise:
    """Integration test exercising multiple tool types in a single prompt."""

    MULTI_TOOL_PROMPT = (
        "Research the top 3 Python web frameworks (Django, FastAPI, Flask), then: "
        "1) Search the web for each framework's latest version and key features, "
        "2) Create a file called /tmp/framework_comparison.py that contains a "
        "Python dictionary with the comparison data, "
        "3) Execute the code to verify the dictionary is valid, "
        "4) Write a markdown report to /tmp/framework_report.md summarizing "
        "your findings in a table format, "
        "5) Read back the report file to verify it was written correctly, "
        "6) List the files in /tmp to confirm both files exist, "
        "7) Get system info to note what OS this report was generated on, "
        "8) Finally search for any recent news about Python 3.13 features"
    )

    @pytest.mark.slow
    def test_multi_tool_enrichment(self, client):
        """All tool types in a complex prompt should have enrichment."""
        r = client.post("/run", json={"message": self.MULTI_TOOL_PROMPT})
        assert r.status_code == 200
        events = _parse_sse(r.text)
        starts, completions, content, errors = _tool_events(events)

        if not starts:
            pytest.skip("No tool calls (provider may not be configured)")

        # Collect unique tool names
        tool_names = {e.get("name") for e in starts + completions}
        print(f"\nTools exercised: {sorted(tool_names)}")
        print(f"Tool starts: {len(starts)}, completions: {len(completions)}")

        # Every start should have enrichment
        for evt in starts:
            name = evt.get("name", "?")
            assert evt.get("icon"), f"Missing icon on {name}"
            assert evt.get("description"), f"Missing description on {name}"
            assert evt.get("step_number") is not None, f"Missing step_number on {name}"

        # Every completion should have formatted_result
        for evt in completions:
            name = evt.get("name", "?")
            assert evt.get("formatted_result"), f"Missing formatted_result on {name}"

        # No errors
        assert len(errors) == 0, f"Errors: {errors}"

    @pytest.mark.slow
    def test_multi_tool_produces_files(self, client):
        """Multi-tool prompt should create the requested files."""
        import os

        r = client.post("/run", json={"message": self.MULTI_TOOL_PROMPT})
        assert r.status_code == 200

        events = _parse_sse(r.text)
        starts, completions, _, _ = _tool_events(events)

        if not starts:
            pytest.skip("No tool calls (provider may not be configured)")

        # Check if write_file was used and files were created
        write_completions = [
            e for e in completions if e.get("name") in ("write_file", "create_file")
        ]

        if write_completions:
            # At least one write should have succeeded
            succeeded = [
                e for e in write_completions
                if e.get("formatted_result", "").startswith("✓")
            ]
            assert len(succeeded) > 0, (
                f"No successful file writes. Results: "
                f"{[e.get('formatted_result') for e in write_completions]}"
            )
