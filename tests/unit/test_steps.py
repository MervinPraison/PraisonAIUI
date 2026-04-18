"""Tests for the Step/Chain-of-Thought UI component.

This module tests the Step class and step decorator to ensure they properly
emit events for the frontend to render collapsible step hierarchies.
"""

import asyncio
import pytest
import uuid
from unittest.mock import AsyncMock, MagicMock

from praisonaiui.message import Step, step
from praisonaiui.server import MessageContext


@pytest.fixture
def mock_context():
    """Create a mock MessageContext with stream queue."""
    context = MagicMock(spec=MessageContext)
    context._stream_queue = AsyncMock()
    return context


@pytest.fixture
def mock_get_context(mock_context, monkeypatch):
    """Mock the _get_context function to return our mock context."""
    def _mock_get_context():
        return mock_context
    
    monkeypatch.setattr("praisonaiui.callbacks._get_context", _mock_get_context)
    return mock_context


class TestStep:
    """Test the Step class functionality."""
    
    def test_step_initialization(self):
        """Test Step class initialization with different parameters."""
        # Basic step
        step1 = Step(name="Test Step")
        assert step1.name == "Test Step"
        assert step1.type == "reasoning"  # default type
        assert step1.parent is None
        assert step1.metadata == {}
        assert step1._id is not None
        
        # Step with all parameters
        parent_step = Step(name="Parent")
        metadata = {"key": "value"}
        step2 = Step(
            name="Child Step",
            type="tool_call",
            parent=parent_step,
            metadata=metadata
        )
        assert step2.name == "Child Step"
        assert step2.type == "tool_call"
        assert step2.parent is parent_step
        assert step2.metadata == metadata
    
    @pytest.mark.asyncio
    async def test_step_context_manager(self, mock_get_context):
        """Test Step as async context manager emits proper events."""
        mock_context = mock_get_context
        
        async with Step(name="Test Step", type="tool_call") as step:
            # Check step started event
            assert mock_context._stream_queue.put.call_count == 1
            start_event = mock_context._stream_queue.put.call_args[0][0]
            assert start_event["type"] == "reasoning_started"
            assert start_event["name"] == "Test Step"
            assert start_event["step_type"] == "tool_call"
            assert start_event["step_id"] == step._id
            assert start_event["parent_id"] is None
            assert "metadata" in start_event
        
        # Check step completed event
        assert mock_context._stream_queue.put.call_count == 2
        end_event = mock_context._stream_queue.put.call_args[0][0]
        assert end_event["type"] == "reasoning_completed"
        assert end_event["name"] == "Test Step"
        assert end_event["step_type"] == "tool_call"
        assert end_event["step_id"] == step._id
        assert end_event["error"] is None
        assert "duration" in end_event
        assert "metadata" in end_event
    
    @pytest.mark.asyncio
    async def test_nested_steps(self, mock_get_context):
        """Test nested step hierarchy with parent_id tracking."""
        mock_context = mock_get_context
        
        async with Step(name="Parent Step", type="reasoning") as parent:
            parent_id = parent._id
            
            async with Step(name="Child Step", type="tool_call", parent=parent) as child:
                # Check that child step references parent
                child_start_event = mock_context._stream_queue.put.call_args[0][0]
                assert child_start_event["parent_id"] == parent_id
                assert child_start_event["step_id"] == child._id
    
    @pytest.mark.asyncio
    async def test_step_stream_token(self, mock_get_context):
        """Test streaming tokens within a step."""
        mock_context = mock_get_context
        
        async with Step(name="Streaming Step", type="reasoning") as step:
            await step.stream_token("First token")
            await step.stream_token("Second token")
        
        # Should have: start, token1, token2, end = 4 calls
        assert mock_context._stream_queue.put.call_count == 4
        
        # Check token events
        token1_call = mock_context._stream_queue.put.call_args_list[1][0][0]
        assert token1_call["type"] == "reasoning_step"
        assert token1_call["step"] == "First token"
        assert token1_call["step_id"] == step._id
        assert token1_call["step_type"] == "reasoning"
        
        token2_call = mock_context._stream_queue.put.call_args_list[2][0][0]
        assert token2_call["type"] == "reasoning_step"
        assert token2_call["step"] == "Second token"
    
    @pytest.mark.asyncio
    async def test_step_with_error(self, mock_get_context):
        """Test step error handling."""
        mock_context = mock_get_context
        
        try:
            async with Step(name="Error Step", type="tool_call") as step:
                raise ValueError("Test error")
        except ValueError:
            pass
        
        # Check completion event has error
        end_event = mock_context._stream_queue.put.call_args[0][0]
        assert end_event["type"] == "reasoning_completed"
        assert end_event["error"] == "Test error"
    
    @pytest.mark.asyncio
    async def test_step_types(self, mock_get_context):
        """Test all supported step types."""
        mock_context = mock_get_context
        step_types = ["tool_call", "reasoning", "sub_agent", "retrieval", "custom"]
        
        for step_type in step_types:
            mock_context._stream_queue.reset_mock()
            async with Step(name=f"Test {step_type}", type=step_type) as step:
                pass
            
            start_event = mock_context._stream_queue.put.call_args_list[0][0][0]
            assert start_event["step_type"] == step_type
            
            end_event = mock_context._stream_queue.put.call_args_list[1][0][0]
            assert end_event["step_type"] == step_type
    
    def test_step_without_context(self):
        """Test Step behavior when no context is available."""
        # This should not crash even without context
        step = Step(name="No Context Step")
        assert step._context is None
    
    @pytest.mark.asyncio
    async def test_step_metadata(self, mock_get_context):
        """Test step metadata is included in events."""
        mock_context = mock_get_context
        metadata = {"tool": "web_search", "version": "1.0"}
        
        async with Step(name="Metadata Step", metadata=metadata) as step:
            pass
        
        start_event = mock_context._stream_queue.put.call_args_list[0][0][0]
        assert start_event["metadata"] == metadata
        
        end_event = mock_context._stream_queue.put.call_args_list[1][0][0]
        assert end_event["metadata"] == metadata


class TestStepDecorator:
    """Test the @step decorator functionality."""
    
    @pytest.mark.asyncio
    async def test_step_decorator_basic(self, mock_get_context):
        """Test basic step decorator usage."""
        mock_context = mock_get_context
        
        @step("Tool Search", type="tool_call")
        async def search_tool(query: str):
            return f"Results for: {query}"
        
        result = await search_tool("test query")
        assert result == "Results for: test query"
        
        # Check events were emitted
        assert mock_context._stream_queue.put.call_count == 2
        start_event = mock_context._stream_queue.put.call_args_list[0][0][0]
        assert start_event["name"] == "Tool Search"
        assert start_event["step_type"] == "tool_call"
    
    @pytest.mark.asyncio
    async def test_step_decorator_with_metadata(self, mock_get_context):
        """Test step decorator with metadata."""
        mock_context = mock_get_context
        
        @step("Custom Step", type="custom", version="1.0", author="test")
        async def custom_function():
            return "done"
        
        result = await custom_function()
        assert result == "done"
        
        start_event = mock_context._stream_queue.put.call_args_list[0][0][0]
        assert start_event["metadata"]["version"] == "1.0"
        assert start_event["metadata"]["author"] == "test"
    
    @pytest.mark.asyncio
    async def test_step_decorator_error_handling(self, mock_get_context):
        """Test step decorator error handling."""
        mock_context = mock_get_context
        
        @step("Error Function", type="tool_call")
        async def error_function():
            raise RuntimeError("Function failed")
        
        with pytest.raises(RuntimeError, match="Function failed"):
            await error_function()
        
        # Check error was captured in completion event
        end_event = mock_context._stream_queue.put.call_args_list[1][0][0]
        assert end_event["error"] == "Function failed"
    
    @pytest.mark.asyncio
    async def test_step_decorator_preserves_function_metadata(self):
        """Test that decorator preserves original function metadata."""
        @step("Test Function")
        async def documented_function(param: str) -> str:
            """This function has documentation."""
            return param
        
        # Check that function metadata is preserved
        assert documented_function.__name__ == "documented_function"
        assert "This function has documentation" in documented_function.__doc__


class TestStepIntegration:
    """Integration tests for Step functionality."""
    
    @pytest.mark.asyncio
    async def test_complex_step_hierarchy(self, mock_get_context):
        """Test complex nested step hierarchy."""
        mock_context = mock_get_context
        
        async with Step(name="Main Task", type="reasoning") as main:
            await main.stream_token("Starting main task...")
            
            async with Step(name="Subtask A", type="tool_call", parent=main) as sub_a:
                await sub_a.stream_token("Running tool A")
                
                async with Step(name="Sub-subtask", type="retrieval", parent=sub_a) as sub_sub:
                    await sub_sub.stream_token("Retrieving data")
            
            async with Step(name="Subtask B", type="sub_agent", parent=main) as sub_b:
                await sub_b.stream_token("Agent processing")
        
        # Verify event sequence and hierarchy
        calls = mock_context._stream_queue.put.call_args_list
        
        # Should have: main_start, main_token, sub_a_start, sub_a_token, 
        # sub_sub_start, sub_sub_token, sub_sub_end, sub_a_end, 
        # sub_b_start, sub_b_token, sub_b_end, main_end = 12 events
        assert len(calls) == 12
        
        # Check hierarchy relationships
        main_id = main._id
        sub_a_id = sub_a._id
        sub_sub_id = sub_sub._id
        
        # Sub A should reference main as parent
        sub_a_start = calls[2][0][0]
        assert sub_a_start["parent_id"] == main_id
        
        # Sub-sub should reference sub A as parent
        sub_sub_start = calls[4][0][0]
        assert sub_sub_start["parent_id"] == sub_a_id
    
    @pytest.mark.asyncio
    async def test_mixed_decorator_and_context_manager(self, mock_get_context):
        """Test mixing decorator and context manager approaches."""
        mock_context = mock_get_context
        
        @step("Decorated Task", type="tool_call")
        async def decorated_task():
            async with Step("Inner Step", type="reasoning") as inner:
                await inner.stream_token("Inner processing")
            return "task complete"
        
        result = await decorated_task()
        assert result == "task complete"
        
        # Should have events from both decorator and inner context manager
        calls = mock_context._stream_queue.put.call_args_list
        assert len(calls) >= 4  # decorated_start, inner_start, inner_token, inner_end, decorated_end


# Test with actual asyncio event loop (mimics real usage)
@pytest.mark.asyncio
async def test_step_timing_realistic(mock_get_context):
    """Test step timing with realistic delays."""
    import time
    mock_context = mock_get_context
    
    async with Step(name="Timed Step", type="tool_call") as step:
        await asyncio.sleep(0.01)  # 10ms delay
    
    end_event = mock_context._stream_queue.put.call_args_list[1][0][0]
    duration = end_event["duration"]
    assert duration is not None
    assert duration >= 0.01  # Should be at least 10ms
    assert duration < 0.1   # Should be less than 100ms (reasonable upper bound)


if __name__ == "__main__":
    pytest.main([__file__])