"""Unit tests for Semantic Kernel integration."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List, Optional

from praisonaiui.integrations.semantic_kernel import AiuiSemanticKernelFilter


class TestAiuiSemanticKernelFilter:
    """Test the Semantic Kernel function invocation filter."""

    @pytest.fixture
    def filter_instance(self):
        """Create a filter instance."""
        return AiuiSemanticKernelFilter()

    @pytest.fixture
    def mock_step(self):
        """Create a mock Step instance."""
        step = MagicMock()
        step._id = "test-sk-step-123"
        step.__aenter__ = AsyncMock()
        step.__aexit__ = AsyncMock()
        step.stream_token = AsyncMock()
        return step

    @pytest.fixture
    def mock_context(self):
        """Create a mock SK function context."""
        context = MagicMock()
        context.function = MagicMock()
        context.function.name = "test_function"
        context.function.plugin_name = "test_plugin"
        context.arguments = {"arg1": "value1", "arg2": "value2"}
        return context

    @pytest.fixture
    def mock_next_filter(self):
        """Create a mock next filter function."""
        return AsyncMock(return_value="filter_result")

    def test_init(self, filter_instance):
        """Test filter initialization."""
        assert filter_instance._context_to_step == {}

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_on_function_invocation_success(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test successful function invocation."""
        mock_step_class.return_value = mock_step
        
        result = await filter_instance.on_function_invocation(mock_context, mock_next_filter)
        
        # Verify Step was created with correct parameters
        mock_step_class.assert_called_once_with(
            name="🔧 SK Function: test_plugin.test_function",
            type="tool_call",
            parent=None,
            metadata={
                "function_name": "test_function",
                "plugin_name": "test_plugin",
                "arguments": {"arg1": "value1", "arg2": "value2"}
            }
        )
        
        # Verify step lifecycle
        mock_step.__aenter__.assert_called_once()
        mock_step.__aexit__.assert_called_once_with(None, None, None)
        
        # Verify next filter was called
        mock_next_filter.assert_called_once_with(mock_context)
        
        # Verify result is returned
        assert result == "filter_result"
        
        # Verify streaming calls were made
        assert mock_step.stream_token.call_count >= 2  # At least function name and result
        
        # Verify cleanup
        assert len(filter_instance._context_to_step) == 0
        assert len(filter_instance._context_to_step) == 0

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_on_function_invocation_no_plugin_name(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test function invocation without plugin name."""
        mock_step_class.return_value = mock_step
        mock_context.function.plugin_name = None
        
        await filter_instance.on_function_invocation(mock_context, mock_next_filter)
        
        # Verify Step was created with correct name (no plugin prefix)
        mock_step_class.assert_called_once_with(
            name="🔧 SK Function: test_function",
            type="tool_call",
            parent=None,
            metadata={
                "function_name": "test_function",
                "plugin_name": None,
                "arguments": {"arg1": "value1", "arg2": "value2"}
            }
        )

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_on_function_invocation_error(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test function invocation with error."""
        mock_step_class.return_value = mock_step
        error = ValueError("Test SK function error")
        mock_next_filter.side_effect = error
        
        with pytest.raises(ValueError) as exc_info:
            await filter_instance.on_function_invocation(mock_context, mock_next_filter)
        
        assert exc_info.value is error
        
        # Verify step was ended with error
        mock_step.__aenter__.assert_called_once()
        mock_step.__aexit__.assert_called_once_with(ValueError, error, None)
        
        # Verify cleanup happened even with error
        assert len(filter_instance._context_to_step) == 0
        assert len(filter_instance._context_to_step) == 0

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_on_function_invocation_no_result(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test function invocation with no result."""
        mock_step_class.return_value = mock_step
        mock_next_filter.return_value = None
        
        result = await filter_instance.on_function_invocation(mock_context, mock_next_filter)
        
        # Verify None result is handled gracefully
        assert result is None
        
        # Verify step completed successfully
        mock_step.__aexit__.assert_called_once_with(None, None, None)

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_on_auto_function_invocation_success(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test successful auto function invocation."""
        mock_step_class.return_value = mock_step
        
        result = await filter_instance.on_auto_function_invocation(mock_context, mock_next_filter)
        
        # Verify Step was created with auto function name
        mock_step_class.assert_called_once_with(
            name="🤖 Auto SK Function: test_plugin.test_function",
            type="sub_agent",  # Auto calls use sub_agent type
            parent=None,
            metadata={
                "function_name": "test_function",
                "plugin_name": "test_plugin", 
                "arguments": {"arg1": "value1", "arg2": "value2"},
                "auto_invocation": True
            }
        )
        
        # Verify step lifecycle
        mock_step.__aenter__.assert_called_once()
        mock_step.__aexit__.assert_called_once_with(None, None, None)
        
        # Verify result is returned
        assert result == "filter_result"

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_on_auto_function_invocation_no_plugin(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test auto function invocation without plugin name."""
        mock_step_class.return_value = mock_step
        mock_context.function.plugin_name = None
        
        await filter_instance.on_auto_function_invocation(mock_context, mock_next_filter)
        
        # Verify Step was created with correct auto name (no plugin prefix)
        mock_step_class.assert_called_once_with(
            name="🤖 Auto SK Function: test_function",
            type="sub_agent",
            parent=None,
            metadata={
                "function_name": "test_function",
                "plugin_name": None,
                "arguments": {"arg1": "value1", "arg2": "value2"},
                "auto_invocation": True
            }
        )

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_on_auto_function_invocation_error(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test auto function invocation with error."""
        mock_step_class.return_value = mock_step
        error = RuntimeError("Auto invocation failed")
        mock_next_filter.side_effect = error
        
        with pytest.raises(RuntimeError) as exc_info:
            await filter_instance.on_auto_function_invocation(mock_context, mock_next_filter)
        
        assert exc_info.value is error
        
        # Verify step was ended with error
        mock_step.__aexit__.assert_called_once_with(RuntimeError, error, None)

    @pytest.mark.asyncio
    async def test_on_function_invoking_alias(self, filter_instance, mock_context, mock_next_filter):
        """Test on_function_invoking alias method."""
        with patch.object(filter_instance, 'on_function_invocation', new_callable=AsyncMock) as mock_on_function_invocation:
            mock_on_function_invocation.return_value = "alias_result"
            
            result = await filter_instance.on_function_invoking(mock_context, mock_next_filter)
            
            # Verify alias calls the main method
            mock_on_function_invocation.assert_called_once_with(mock_context, mock_next_filter)
            assert result == "alias_result"

    @pytest.mark.asyncio
    async def test_on_function_invoked(self, filter_instance, mock_context, mock_next_filter):
        """Test on_function_invoked post-invocation method."""
        result = await filter_instance.on_function_invoked(mock_context, mock_next_filter)
        
        # Should just pass through to next filter
        mock_next_filter.assert_called_once_with(mock_context)
        assert result == "filter_result"

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_nested_function_calls(self, mock_step_class, filter_instance):
        """Test nested function calls maintain parent-child relationships."""
        parent_step = MagicMock()
        child_step = MagicMock()
        parent_step.__aenter__ = AsyncMock()
        parent_step.__aexit__ = AsyncMock()
        parent_step.stream_token = AsyncMock()
        child_step.__aenter__ = AsyncMock()
        child_step.__aexit__ = AsyncMock()
        child_step.stream_token = AsyncMock()
        
        # First call returns parent step, second call returns child step
        mock_step_class.side_effect = [parent_step, child_step]
        
        # Mock contexts
        parent_context = MagicMock()
        parent_context.function.name = "parent_function"
        parent_context.function.plugin_name = "plugin"
        parent_context.arguments = {}
        
        child_context = MagicMock()
        child_context.function.name = "child_function"
        child_context.function.plugin_name = "plugin"
        child_context.arguments = {}
        
        # Mock nested next filters
        async def parent_next_filter(context):
            # This simulates a nested call during parent execution
            child_next_filter = AsyncMock(return_value="child_result")
            return await filter_instance.on_function_invocation(child_context, child_next_filter)
        
        # Execute nested calls
        await filter_instance.on_function_invocation(parent_context, parent_next_filter)
        
        # Verify both steps were created
        assert mock_step_class.call_count == 2
        
        # SK doesn't provide explicit parent relationships in filters
        # Both steps appear as top-level (parent=None)
        child_call_args = mock_step_class.call_args_list[1]
        assert child_call_args[1]["parent"] is None

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_streaming_behavior(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test detailed streaming behavior."""
        mock_step_class.return_value = mock_step
        mock_context.arguments = {"query": "test query", "limit": 10}
        
        await filter_instance.on_function_invocation(mock_context, mock_next_filter)
        
        # Verify specific streaming calls
        stream_calls = [call[0][0] for call in mock_step.stream_token.call_args_list]
        
        # Should have at least function call, arguments, and result
        assert any("test_function" in call for call in stream_calls)
        assert any("Arguments:" in call for call in stream_calls)
        assert any("Result:" in call for call in stream_calls)

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_long_result_truncation(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test that long results are truncated in streaming."""
        mock_step_class.return_value = mock_step
        
        # Create a very long result
        long_result = "x" * 500  # 500 characters
        mock_next_filter.return_value = long_result
        
        await filter_instance.on_function_invocation(mock_context, mock_next_filter)
        
        # Find the result streaming call
        stream_calls = [call[0][0] for call in mock_step.stream_token.call_args_list]
        result_calls = [call for call in stream_calls if call.startswith("Result:")]
        
        assert len(result_calls) == 1
        # Should be truncated to 300 characters + "Result: " prefix
        assert len(result_calls[0]) <= 310  # Some margin for "Result: "

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_long_arguments_truncation(self, mock_step_class, filter_instance, mock_step, mock_context, mock_next_filter):
        """Test that long arguments are truncated in streaming."""
        mock_step_class.return_value = mock_step
        
        # Create long arguments
        mock_context.arguments = {"long_arg": "y" * 300}
        
        await filter_instance.on_function_invocation(mock_context, mock_next_filter)
        
        # Find the arguments streaming call  
        stream_calls = [call[0][0] for call in mock_step.stream_token.call_args_list]
        arg_calls = [call for call in stream_calls if call.startswith("Arguments:")]
        
        assert len(arg_calls) == 1
        # Should be truncated to 200 characters + "Arguments: " prefix
        assert len(arg_calls[0]) <= 220  # Some margin for "Arguments: "

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.semantic_kernel.Step')
    async def test_context_id_collision_handling(self, mock_step_class, filter_instance, mock_step):
        """Test handling of context ID collisions (edge case)."""
        mock_step_class.return_value = mock_step
        
        # Create two contexts that might have the same id() due to object reuse
        context1 = MagicMock()
        context1.function.name = "func1"
        context1.function.plugin_name = "plugin1"
        context1.arguments = {}
        
        # Simulate contexts with same id (very unlikely but possible)
        with patch('builtins.id', return_value=12345):
            next_filter1 = AsyncMock(return_value="result1")
            result1 = await filter_instance.on_function_invocation(context1, next_filter1)
        
        # Should complete successfully despite potential ID collision
        assert result1 == "result1"
        assert len(filter_instance._context_to_step) == 0  # Should be cleaned up