"""Unit tests for LangChain integration."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List, Union

from praisonaiui.integrations.langchain import AiuiLangChainCallbackHandler, AsyncAiuiLangChainCallbackHandler


class TestAiuiLangChainCallbackHandler:
    """Test the sync LangChain callback handler."""

    @pytest.fixture
    def handler(self):
        """Create a callback handler instance."""
        return AiuiLangChainCallbackHandler()

    @pytest.fixture
    def mock_step(self):
        """Create a mock Step instance."""
        step = MagicMock()
        step._id = "test-step-123"
        step.__aenter__ = AsyncMock()
        step.__aexit__ = AsyncMock()
        step.stream_token = AsyncMock()
        return step

    def test_init(self, handler):
        """Test handler initialization."""
        assert handler._run_id_to_step == {}
        assert hasattr(handler, '_lock')

    @patch('praisonaiui.integrations.langchain.Step')
    @patch('asyncio.create_task')
    def test_on_chain_start(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test chain start event creates a step."""
        mock_step_class.return_value = mock_step
        
        serialized = {"name": "test_chain", "id": ["chain", "test"]}
        inputs = {"input": "test query"}
        run_id = "run_123"
        
        handler.on_chain_start(serialized, inputs, run_id=run_id)
        
        # Verify Step was created with correct parameters
        mock_step_class.assert_called_once_with(
            name="🔗 Chain: test_chain",
            type="reasoning",
            parent=None,
            metadata={"inputs": inputs, "serialized": serialized}
        )
        
        # Verify step is tracked
        assert handler._run_id_to_step[run_id] == mock_step

    @patch('praisonaiui.integrations.langchain.Step')
    @patch('asyncio.create_task')
    def test_on_chain_start_with_list_name(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test chain start with list-style name."""
        mock_step_class.return_value = mock_step
        
        serialized = {"id": ["langchain", "chains", "ConversationChain"]}
        inputs = {"input": "test"}
        run_id = "run_123"
        
        handler.on_chain_start(serialized, inputs, run_id=run_id)
        
        mock_step_class.assert_called_once_with(
            name="🔗 Chain: ConversationChain",
            type="reasoning",
            parent=None,
            metadata={"inputs": inputs, "serialized": serialized}
        )

    @patch('asyncio.get_running_loop')
    @patch('asyncio.create_task')
    def test_on_chain_end(self, mock_create_task, mock_get_loop, handler, mock_step):
        """Test chain end event cleans up step."""
        # Mock that there's a running event loop
        mock_get_loop.return_value = MagicMock()
        
        run_id = "run_123"
        handler._run_id_to_step[run_id] = mock_step
        handler._run_id_to_step[run_id] = mock_step
        
        outputs = {"output": "test response"}
        handler.on_chain_end(outputs, run_id=run_id)
        
        # Verify async task was created for step exit
        mock_create_task.assert_called_once()
        
        # Verify cleanup
        assert run_id not in handler._run_id_to_step
        assert run_id not in handler._run_id_to_step

    @patch('asyncio.get_running_loop')
    @patch('asyncio.create_task')
    def test_on_chain_error(self, mock_create_task, mock_get_loop, handler, mock_step):
        """Test chain error event cleans up step with error."""
        # Mock that there's a running event loop
        mock_get_loop.return_value = MagicMock()
        
        run_id = "run_123"
        handler._run_id_to_step[run_id] = mock_step
        handler._run_id_to_step[run_id] = mock_step
        
        error = Exception("Test error")
        handler.on_chain_error(error, run_id=run_id)
        
        # Verify async task was created for step exit with error
        mock_create_task.assert_called_once()
        
        # Verify cleanup
        assert run_id not in handler._run_id_to_step
        assert run_id not in handler._run_id_to_step

    @patch('praisonaiui.integrations.langchain.Step')
    @patch('asyncio.create_task')
    def test_on_llm_start(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test LLM start event."""
        mock_step_class.return_value = mock_step
        
        serialized = {"name": "OpenAI"}
        prompts = ["What is the capital of France?"]
        run_id = "run_123"
        
        handler.on_llm_start(serialized, prompts, run_id=run_id)
        
        mock_step_class.assert_called_once_with(
            name="🤖 LLM: OpenAI",
            type="reasoning",
            parent=None,
            metadata={"prompts": prompts, "serialized": serialized}
        )
        
        # Verify step is tracked
        assert handler._run_id_to_step[run_id] == mock_step

    @patch('asyncio.get_running_loop')
    @patch('asyncio.create_task')
    def test_on_llm_new_token(self, mock_create_task, mock_get_loop, handler, mock_step):
        """Test LLM token streaming."""
        # Mock that there's a running event loop
        mock_get_loop.return_value = MagicMock()
        
        run_id = "run_123"
        handler._run_id_to_step[run_id] = mock_step
        
        token = "Paris"
        handler.on_llm_new_token(token, run_id=run_id)
        
        # Verify async task was created for token streaming
        mock_create_task.assert_called_once()

    @patch('praisonaiui.integrations.langchain.Step')
    @patch('asyncio.create_task')
    def test_on_tool_start(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test tool start event."""
        mock_step_class.return_value = mock_step
        
        serialized = {"name": "web_search"}
        input_str = "python tutorial"
        run_id = "run_123"
        
        handler.on_tool_start(serialized, input_str, run_id=run_id)
        
        mock_step_class.assert_called_once_with(
            name="🔧 Tool: web_search",
            type="tool_call",
            parent=None,
            metadata={"input": input_str, "serialized": serialized}
        )

    @patch('asyncio.create_task')
    def test_on_tool_end(self, mock_create_task, handler, mock_step):
        """Test tool end event."""
        run_id = "run_123"
        handler._run_id_to_step[run_id] = mock_step
        handler._run_id_to_step[run_id] = mock_step
        
        output = "Found 10 results"
        handler.on_tool_end(output, run_id=run_id)
        
        # Verify cleanup happened
        assert run_id not in handler._run_id_to_step
        assert run_id not in handler._run_id_to_step

    @patch('praisonaiui.integrations.langchain.Step')
    @patch('asyncio.create_task')
    def test_on_agent_action(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test agent action event."""
        mock_step_class.return_value = mock_step
        
        # Mock action object
        action = MagicMock()
        action.tool = "calculator"
        run_id = "run_123"
        
        handler.on_agent_action(action, run_id=run_id)
        
        mock_step_class.assert_called_once_with(
            name="🎯 Agent Action: calculator",
            type="sub_agent",
            parent=None,
            metadata={"action": str(action)}
        )

    @patch('asyncio.create_task')
    def test_no_event_loop_handling(self, mock_create_task, handler, mock_step):
        """Test graceful handling when no event loop is running."""
        # Simulate RuntimeError when no event loop is present
        mock_create_task.side_effect = RuntimeError("no running event loop")
        
        run_id = "run_123"
        handler._run_id_to_step[run_id] = mock_step
        handler._run_id_to_step[run_id] = mock_step
        
        # Should not raise exception
        handler.on_chain_end({}, run_id=run_id)
        
        # Cleanup should still happen
        assert run_id not in handler._run_id_to_step
        assert run_id not in handler._run_id_to_step

    def test_missing_run_id(self, handler):
        """Test events without run_id are ignored."""
        # Events without run_id should be safely ignored
        handler.on_chain_start({}, {})
        handler.on_chain_end({})
        handler.on_llm_start({}, [])
        handler.on_tool_start({}, "")
        
        assert len(handler._run_id_to_step) == 0
        assert len(handler._run_id_to_step) == 0

    def test_nested_steps(self, handler):
        """Test that nested steps maintain parent-child relationships."""
        with patch('praisonaiui.integrations.langchain.Step') as mock_step_class:
            with patch('asyncio.create_task'):
                parent_step = MagicMock()
                child_step = MagicMock()
                
                # First call returns parent step
                # Second call returns child step
                mock_step_class.side_effect = [parent_step, child_step]
                
                # Start parent chain
                handler.on_chain_start({"name": "parent"}, {}, run_id="parent_run")
                
                # Start nested LLM call with parent_run_id
                handler.on_llm_start({"name": "OpenAI"}, ["test"], run_id="child_run", parent_run_id="parent_run")
                
                # Verify child step was created with parent
                assert mock_step_class.call_count == 2
                child_call_args = mock_step_class.call_args_list[1]
                assert child_call_args[1]["parent"] == parent_step


class TestAsyncAiuiLangChainCallbackHandler:
    """Test the async LangChain callback handler."""

    @pytest.fixture
    def handler(self):
        """Create an async callback handler instance."""
        return AsyncAiuiLangChainCallbackHandler()

    @pytest.fixture
    def mock_step(self):
        """Create a mock Step instance."""
        step = MagicMock()
        step._id = "test-step-456"
        step.__aenter__ = AsyncMock()
        step.__aexit__ = AsyncMock()
        step.stream_token = AsyncMock()
        return step

    def test_init(self, handler):
        """Test async handler initialization."""
        assert handler._run_id_to_step == {}
        assert hasattr(handler, '_lock')

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.langchain.Step')
    async def test_on_chain_start(self, mock_step_class, handler, mock_step):
        """Test async chain start event."""
        mock_step_class.return_value = mock_step
        
        serialized = {"name": "async_chain"}
        inputs = {"input": "async test"}
        run_id = "async_run_123"
        
        await handler.on_chain_start(serialized, inputs, run_id=run_id)
        
        # Verify Step was created
        mock_step_class.assert_called_once_with(
            name="🔗 Chain: async_chain",
            type="reasoning",
            parent=None,
            metadata={"inputs": inputs, "serialized": serialized}
        )
        
        # Verify step was started
        mock_step.__aenter__.assert_called_once()
        
        # Verify tracking
        # Verify step is tracked
        assert handler._run_id_to_step[run_id] == mock_step

    @pytest.mark.asyncio
    async def test_on_chain_end(self, handler, mock_step):
        """Test async chain end event."""
        run_id = "async_run_123"
        handler._run_id_to_step[run_id] = mock_step
        handler._run_id_to_step[run_id] = mock_step
        
        outputs = {"output": "async response"}
        await handler.on_chain_end(outputs, run_id=run_id)
        
        # Verify step was ended
        mock_step.__aexit__.assert_called_once_with(None, None, None)
        
        # Verify cleanup
        assert run_id not in handler._run_id_to_step
        assert run_id not in handler._run_id_to_step

    @pytest.mark.asyncio
    async def test_on_chain_error(self, handler, mock_step):
        """Test async chain error event."""
        run_id = "async_run_123"
        handler._run_id_to_step[run_id] = mock_step
        handler._run_id_to_step[run_id] = mock_step
        
        error = ValueError("Async test error")
        await handler.on_chain_error(error, run_id=run_id)
        
        # Verify step was ended with error
        mock_step.__aexit__.assert_called_once_with(ValueError, error, None)
        
        # Verify cleanup
        assert run_id not in handler._run_id_to_step
        assert run_id not in handler._run_id_to_step

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.langchain.Step')
    async def test_on_llm_start_with_token_streaming(self, mock_step_class, handler, mock_step):
        """Test async LLM start with token streaming."""
        mock_step_class.return_value = mock_step
        
        serialized = {"name": "GPT-4"}
        prompts = ["Explain quantum computing"]
        run_id = "llm_run_123"
        
        # Start LLM
        await handler.on_llm_start(serialized, prompts, run_id=run_id)
        
        # Verify initial prompt was streamed
        mock_step.stream_token.assert_called_once()
        call_args = mock_step.stream_token.call_args[0][0]
        assert "Prompt:" in call_args
        assert "Explain quantum computing" in call_args
        
        # Test token streaming
        await handler.on_llm_new_token("Quantum", run_id=run_id)
        await handler.on_llm_new_token(" computing", run_id=run_id)
        
        # Verify tokens were streamed
        assert mock_step.stream_token.call_count == 3
        
        # End LLM
        await handler.on_llm_end("Response", run_id=run_id)
        
        # Verify step ended and cleaned up
        mock_step.__aexit__.assert_called_once_with(None, None, None)
        assert run_id not in handler._run_id_to_step

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.langchain.Step')
    async def test_on_tool_workflow(self, mock_step_class, handler, mock_step):
        """Test complete tool workflow."""
        mock_step_class.return_value = mock_step
        
        serialized = {"name": "calculator"}
        input_str = "2 + 2"
        run_id = "tool_run_123"
        
        # Start tool
        await handler.on_tool_start(serialized, input_str, run_id=run_id)
        
        # Verify tool step was started and input streamed
        mock_step.__aenter__.assert_called_once()
        mock_step.stream_token.assert_called_once_with("Input: 2 + 2")
        
        # End tool
        output = "4"
        await handler.on_tool_end(output, run_id=run_id)
        
        # Verify output was streamed and step ended
        assert mock_step.stream_token.call_count == 2
        mock_step.stream_token.assert_any_call("Output: 4")
        mock_step.__aexit__.assert_called_once_with(None, None, None)

    @pytest.mark.asyncio
    @patch('praisonaiui.integrations.langchain.Step')
    async def test_on_agent_workflow(self, mock_step_class, handler, mock_step):
        """Test complete agent workflow."""
        mock_step_class.return_value = mock_step
        
        # Mock agent action
        action = MagicMock()
        action.tool = "web_search"
        run_id = "agent_run_123"
        
        # Start agent action
        await handler.on_agent_action(action, run_id=run_id)
        
        # Verify agent step was started
        mock_step.__aenter__.assert_called_once()
        mock_step.stream_token.assert_called_once()
        
        # Finish agent action
        finish = MagicMock()
        await handler.on_agent_finish(finish, run_id=run_id)
        
        # Verify result was streamed and step ended
        assert mock_step.stream_token.call_count == 2
        mock_step.__aexit__.assert_called_once_with(None, None, None)

    @pytest.mark.asyncio
    async def test_unknown_run_id_ignored(self, handler):
        """Test that events with unknown run_ids are safely ignored."""
        # These should not raise exceptions
        await handler.on_chain_end({}, run_id="unknown")
        await handler.on_llm_new_token("token", run_id="unknown")
        await handler.on_tool_end("output", run_id="unknown")
        
        assert len(handler._run_id_to_step) == 0
        assert len(handler._run_id_to_step) == 0