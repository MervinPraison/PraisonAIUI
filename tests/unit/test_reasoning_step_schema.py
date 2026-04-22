"""Unit tests for rich reasoning step schema (ReasoningStep dataclass and helpers)."""

from dataclasses import asdict


class TestReasoningStepSchema:
    """Tests for ReasoningStep dataclass and emit_reasoning_step helper."""

    def test_reasoning_step_creation_minimal(self):
        """Test ReasoningStep creation with only required fields."""
        from praisonaiui.provider import ReasoningStep

        step = ReasoningStep(title="Planning approach")
        assert step.title == "Planning approach"
        assert step.result == ""
        assert step.reasoning == ""
        assert step.action is None
        assert step.confidence is None
        assert step.next_action is None

    def test_reasoning_step_creation_full(self):
        """Test ReasoningStep creation with all optional fields."""
        from praisonaiui.provider import ReasoningStep

        step = ReasoningStep(
            title="Search for user information",
            result="Found 3 relevant documents",
            reasoning="Need to find user preferences before proceeding",
            action="search",
            confidence=0.85,
            next_action="analyze search results"
        )

        assert step.title == "Search for user information"
        assert step.result == "Found 3 relevant documents"
        assert step.reasoning == "Need to find user preferences before proceeding"
        assert step.action == "search"
        assert step.confidence == 0.85
        assert step.next_action == "analyze search results"

    def test_reasoning_step_dataclass_serialization(self):
        """Test that ReasoningStep can be serialized to dict."""
        from praisonaiui.provider import ReasoningStep

        step = ReasoningStep(
            title="Verify solution",
            action="verify",
            confidence=0.9
        )

        step_dict = asdict(step)
        expected = {
            "title": "Verify solution",
            "result": "",
            "reasoning": "",
            "action": "verify",
            "confidence": 0.9,
            "next_action": None
        }
        assert step_dict == expected

    def test_emit_reasoning_step_minimal(self):
        """Test emit_reasoning_step with minimal ReasoningStep."""
        from praisonaiui.provider import ReasoningStep, RunEventType, emit_reasoning_step

        step = ReasoningStep(title="Simple step")
        event = emit_reasoning_step(step)

        assert event.type == RunEventType.REASONING_STEP
        assert event.step == "Simple step"
        assert event.action is None
        assert event.confidence is None
        assert event.next_action is None
        assert event.extra_data is None

    def test_emit_reasoning_step_full(self):
        """Test emit_reasoning_step with full ReasoningStep."""
        from praisonaiui.provider import ReasoningStep, RunEventType, emit_reasoning_step

        step = ReasoningStep(
            title="Complex analysis",
            result="Analysis complete",
            reasoning="Performed statistical analysis",
            action="analyze",
            confidence=0.95,
            next_action="generate report"
        )
        event = emit_reasoning_step(step)

        assert event.type == RunEventType.REASONING_STEP
        assert event.step == "Complex analysis"
        assert event.action == "analyze"
        assert event.confidence == 0.95
        assert event.next_action == "generate report"
        assert event.extra_data == {
            "result": "Analysis complete",
            "reasoning": "Performed statistical analysis"
        }

    def test_emit_reasoning_step_partial_extra_data(self):
        """Test emit_reasoning_step with only result in extra_data."""
        from praisonaiui.provider import ReasoningStep, emit_reasoning_step

        step = ReasoningStep(
            title="Step with result",
            result="Got result",
            action="execute"
        )
        event = emit_reasoning_step(step)

        assert event.extra_data == {
            "result": "Got result",
            "reasoning": ""
        }

    def test_run_event_serialization_with_reasoning_fields(self):
        """Test that RunEvent correctly serializes new reasoning fields."""
        from praisonaiui.provider import RunEvent, RunEventType

        event = RunEvent(
            type=RunEventType.REASONING_STEP,
            step="Test step",
            action="plan",
            confidence=0.8,
            next_action="execute plan"
        )

        event_dict = event.to_dict()

        assert event_dict["type"] == "reasoning_step"
        assert event_dict["step"] == "Test step"
        assert event_dict["action"] == "plan"
        assert event_dict["confidence"] == 0.8
        assert event_dict["next_action"] == "execute plan"
        assert "event_id" in event_dict
        assert "timestamp" in event_dict

    def test_run_event_serialization_excludes_none_fields(self):
        """Test that RunEvent to_dict excludes None values for optional reasoning fields."""
        from praisonaiui.provider import RunEvent, RunEventType

        event = RunEvent(
            type=RunEventType.REASONING_STEP,
            step="Test step"
            # action, confidence, next_action are None by default
        )

        event_dict = event.to_dict()

        assert event_dict["type"] == "reasoning_step"
        assert event_dict["step"] == "Test step"
        assert "action" not in event_dict
        assert "confidence" not in event_dict
        assert "next_action" not in event_dict

    def test_backward_compatibility_simple_step(self):
        """Test that existing simple step emission still works."""
        from praisonaiui.provider import RunEvent, RunEventType

        # This is how providers currently emit reasoning steps
        event = RunEvent(type=RunEventType.REASONING_STEP, step="Simple reasoning step")

        event_dict = event.to_dict()
        assert event_dict["type"] == "reasoning_step"
        assert event_dict["step"] == "Simple reasoning step"
        assert "action" not in event_dict
        assert "confidence" not in event_dict


class TestReasoningStepExports:
    """Test that ReasoningStep and helper are properly exported."""

    def test_reasoning_step_export(self):
        """Test that ReasoningStep is available from main package."""
        import praisonaiui

        # Should be importable from main package
        step = praisonaiui.ReasoningStep(title="Exported step")
        assert step.title == "Exported step"

    def test_emit_reasoning_step_export(self):
        """Test that emit_reasoning_step is available from main package."""
        import praisonaiui

        step = praisonaiui.ReasoningStep(title="Test step", confidence=0.9)
        event = praisonaiui.emit_reasoning_step(step)

        assert event.type == praisonaiui.RunEventType.REASONING_STEP
        assert event.step == "Test step"
        assert event.confidence == 0.9
