"""Unit tests for LlamaIndex integration."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List, Optional

from praisonaiui.integrations.llama_index import AiuiLlamaIndexCallbackHandler


class TestAiuiLlamaIndexCallbackHandler:
    """Test the LlamaIndex callback handler."""

    @pytest.fixture
    def handler(self):
        """Create a callback handler instance."""
        return AiuiLlamaIndexCallbackHandler()

    @pytest.fixture
    def mock_step(self):
        """Create a mock Step instance."""
        step = MagicMock()
        step._id = "test-llama-step-123"
        step.__aenter__ = AsyncMock()
        step.__aexit__ = AsyncMock()
        step.stream_token = AsyncMock()
        return step

    def test_init(self, handler):
        """Test handler initialization."""
        assert handler._event_id_to_step == {}
        assert handler._parent_map == {}

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_event_start_query(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test query event start."""
        mock_step_class.return_value = mock_step
        
        event_type = "query"
        payload = {"query": "What is machine learning?"}
        
        event_id = handler.on_event_start(event_type, payload)
        
        # Verify Step was created with correct parameters
        mock_step_class.assert_called_once_with(
            name="🔍 Query Engine",
            type="reasoning",
            parent=None,
            metadata={"event_type": event_type, "payload": payload}
        )
        
        # Verify tracking
        assert handler._event_id_to_step[event_id] == mock_step

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_event_start_retrieve(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test retrieval event start."""
        mock_step_class.return_value = mock_step
        
        event_type = "retrieve"
        payload = {"query": "search query"}
        
        event_id = handler.on_event_start(event_type, payload)
        
        mock_step_class.assert_called_once_with(
            name="📚 Retrieval",
            type="retrieval",
            parent=None,
            metadata={"event_type": event_type, "payload": payload}
        )

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_event_start_synthesize(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test synthesis event start."""
        mock_step_class.return_value = mock_step
        
        event_type = "synthesize"
        payload = {}
        
        event_id = handler.on_event_start(event_type, payload)
        
        mock_step_class.assert_called_once_with(
            name="🧠 Synthesis",
            type="reasoning",
            parent=None,
            metadata={"event_type": event_type, "payload": payload}
        )

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_event_start_llm(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test LLM event start."""
        mock_step_class.return_value = mock_step
        
        event_type = "llm"
        payload = {"messages": ["test message"]}
        
        event_id = handler.on_event_start(event_type, payload)
        
        mock_step_class.assert_called_once_with(
            name="🤖 LLM Call",
            type="reasoning",
            parent=None,
            metadata={"event_type": event_type, "payload": payload}
        )

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_event_start_embedding(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test embedding event start."""
        mock_step_class.return_value = mock_step
        
        event_type = "embedding"
        payload = {"text": "some text to embed"}
        
        event_id = handler.on_event_start(event_type, payload)
        
        mock_step_class.assert_called_once_with(
            name="🔢 Embedding",
            type="custom",
            parent=None,
            metadata={"event_type": event_type, "payload": payload}
        )

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_event_start_tool(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test tool event start."""
        mock_step_class.return_value = mock_step
        
        event_type = "tool_search"
        payload = {"tool": "web_search", "input": "python tutorials"}
        
        event_id = handler.on_event_start(event_type, payload)
        
        mock_step_class.assert_called_once_with(
            name="🔧 Tool: tool_search",
            type="tool_call",
            parent=None,
            metadata={"event_type": event_type, "payload": payload}
        )

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_event_start_unknown(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test unknown event type."""
        mock_step_class.return_value = mock_step
        
        event_type = "custom_event"
        payload = {"data": "test"}
        
        event_id = handler.on_event_start(event_type, payload)
        
        mock_step_class.assert_called_once_with(
            name="⚙️ Custom_Event",
            type="custom",
            parent=None,
            metadata={"event_type": event_type, "payload": payload}
        )

    @patch('asyncio.get_running_loop')
    @patch('asyncio.create_task')
    def test_on_event_end(self, mock_create_task, mock_get_loop, handler, mock_step):
        """Test event end handling."""
        # Mock that there's a running event loop
        mock_get_loop.return_value = MagicMock()
        
        event_id = "test_event_123"
        handler._event_id_to_step[event_id] = mock_step
        
        payload = {"response": "Test response"}
        handler.on_event_end("query", payload, event_id)
        
        # Verify async task was created
        mock_create_task.assert_called_once()
        
        # Verify cleanup
        # Step should be removed from tracking maps
        assert event_id not in handler._event_id_to_step

    @patch('asyncio.get_running_loop')
    @patch('asyncio.create_task')
    def test_on_event_error(self, mock_create_task, mock_get_loop, handler, mock_step):
        """Test event error handling."""
        # Mock that there's a running event loop
        mock_get_loop.return_value = MagicMock()
        
        event_id = "test_event_123"
        handler._event_id_to_step[event_id] = mock_step
        
        exception = ValueError("Test error")
        handler.on_event_error("query", exception, event_id)
        
        # Verify async task was created
        mock_create_task.assert_called_once()
        
        # Verify cleanup
        # Step should be removed from tracking maps
        assert event_id not in handler._event_id_to_step

    def test_start_trace_end_trace(self, handler):
        """Test legacy trace methods (should be no-op)."""
        # These should not raise exceptions
        handler.start_trace("trace_123")
        handler.end_trace("trace_123", {"step1": ["event1", "event2"]})

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_query_start(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test query start convenience method."""
        mock_step_class.return_value = mock_step
        
        query = "What is artificial intelligence?"
        event_id = handler.on_query_start(query, event_id="query_123")
        
        # Should create query step
        mock_step_class.assert_called_once_with(
            name="🔍 Query Engine",
            type="reasoning",
            parent=None,
            metadata={"event_type": "query", "payload": {"query": query}}
        )
        
        assert event_id == "query_123"

    @patch('asyncio.create_task')
    def test_on_query_end(self, mock_create_task, handler, mock_step):
        """Test query end convenience method."""
        event_id = "query_123"
        handler._event_id_to_step[event_id] = mock_step
        
        response = MagicMock()
        response.__str__ = MagicMock(return_value="AI is a field of computer science")
        
        handler.on_query_end(response, event_id=event_id)
        
        # Verify cleanup
        # Step should be removed from tracking maps
        assert event_id not in handler._event_id_to_step

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_retrieve_start(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test retrieval start convenience method."""
        mock_step_class.return_value = mock_step
        
        query = "machine learning concepts"
        event_id = handler.on_retrieve_start(query, event_id="retrieve_123")
        
        mock_step_class.assert_called_once_with(
            name="📚 Retrieval",
            type="retrieval",
            parent=None,
            metadata={"event_type": "retrieve", "payload": {"query": query}}
        )

    @patch('asyncio.create_task')
    def test_on_retrieve_end(self, mock_create_task, handler, mock_step):
        """Test retrieval end convenience method."""
        event_id = "retrieve_123"
        handler._event_id_to_step[event_id] = mock_step
        
        # Mock nodes
        node1 = MagicMock()
        node1.__str__ = MagicMock(return_value="Node 1 content")
        node2 = MagicMock()
        node2.__str__ = MagicMock(return_value="Node 2 content")
        nodes = [node1, node2]
        
        handler.on_retrieve_end(nodes, event_id=event_id)
        
        # Verify cleanup
        # Step should be removed from tracking maps
        assert event_id not in handler._event_id_to_step

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_on_llm_start(self, mock_create_task, mock_step_class, handler, mock_step):
        """Test LLM start convenience method."""
        mock_step_class.return_value = mock_step
        
        messages = ["System: You are helpful", "User: What is Python?"]
        event_id = handler.on_llm_start(messages, event_id="llm_123")
        
        mock_step_class.assert_called_once_with(
            name="🤖 LLM Call",
            type="reasoning",
            parent=None,
            metadata={"event_type": "llm", "payload": {"messages": messages}}
        )

    @patch('asyncio.get_running_loop')
    @patch('asyncio.create_task')
    def test_on_llm_new_token(self, mock_create_task, mock_get_loop, handler, mock_step):
        """Test LLM token streaming."""
        # Mock that there's a running event loop
        mock_get_loop.return_value = MagicMock()
        
        event_id = "llm_123"
        handler._event_id_to_step[event_id] = mock_step
        
        token = "Python"
        handler.on_llm_new_token(token, event_id=event_id)
        
        # Verify async task was created for token streaming
        mock_create_task.assert_called_once()

    @patch('asyncio.create_task')
    def test_on_llm_end(self, mock_create_task, handler, mock_step):
        """Test LLM end convenience method."""
        event_id = "llm_123"
        handler._event_id_to_step[event_id] = mock_step
        
        response = "Python is a programming language"
        handler.on_llm_end(response, event_id=event_id)
        
        # Verify cleanup
        # Step should be removed from tracking maps
        assert event_id not in handler._event_id_to_step

    def test_no_event_loop_handling(self, handler, mock_step):
        """Test graceful handling when no event loop is running."""
        with patch('asyncio.create_task') as mock_create_task:
            # Simulate RuntimeError when no event loop is present
            mock_create_task.side_effect = RuntimeError("no running event loop")
            
            event_id = "test_event_123"
            handler._event_id_to_step[event_id] = mock_step
            
            # Should not raise exception
            handler.on_event_end("query", {}, event_id)
            
            # Cleanup should still happen
            assert event_id not in handler._event_id_to_step

    def test_missing_event_id(self, handler):
        """Test events without event_id are ignored."""
        # Events without event_id should be safely ignored
        handler.on_event_end("query", {}, event_id=None)
        handler.on_event_error("query", Exception("test"), event_id=None)
        handler.on_llm_new_token("token", event_id=None)
        
        assert len(handler._event_id_to_step) == 0
        assert len(handler._event_id_to_step) == 0

    def test_unknown_event_id(self, handler):
        """Test events with unknown event_id are ignored."""
        # Events with unknown event_id should be safely ignored
        handler.on_event_end("query", {}, event_id="unknown_123")
        handler.on_event_error("query", Exception("test"), event_id="unknown_123")
        handler.on_llm_new_token("token", event_id="unknown_123")
        
        assert len(handler._event_id_to_step) == 0
        assert len(handler._event_id_to_step) == 0

    @patch('praisonaiui.integrations.llama_index.Step')
    @patch('asyncio.create_task')
    def test_nested_events(self, mock_create_task, mock_step_class, handler):
        """Test nested event handling maintains parent-child relationships."""
        parent_step = MagicMock()
        child_step = MagicMock()
        
        # First call returns parent step, second call returns child step
        mock_step_class.side_effect = [parent_step, child_step]
        
        # Start parent query
        parent_id = handler.on_event_start("query", {"query": "test"})
        
        # Start nested retrieval with parent_id
        child_id = handler.on_event_start("retrieve", {"query": "test"}, parent_id=parent_id)
        
        # Verify child step was created with parent
        assert mock_step_class.call_count == 2
        child_call_args = mock_step_class.call_args_list[1]
        assert child_call_args[1]["parent"] == parent_step

    @pytest.mark.asyncio
    async def test_async_start_step(self, handler, mock_step):
        """Test async _start_step method."""
        # Test with query payload
        query_payload = {"query": "What is ML?"}
        await handler._start_step(mock_step, query_payload)
        
        mock_step.__aenter__.assert_called_once()
        mock_step.stream_token.assert_called_once_with("Query: What is ML?")

    @pytest.mark.asyncio
    async def test_async_start_step_with_messages(self, handler, mock_step):
        """Test async _start_step with messages payload."""
        messages_payload = {"messages": ["Long message content that should be truncated"]}
        await handler._start_step(mock_step, messages_payload)
        
        mock_step.__aenter__.assert_called_once()
        mock_step.stream_token.assert_called_once()
        call_args = mock_step.stream_token.call_args[0][0]
        assert "Messages:" in call_args
        assert "Long message content" in call_args

    @pytest.mark.asyncio
    async def test_async_end_step(self, handler, mock_step):
        """Test async _end_step method."""
        # Test with response payload
        response_payload = {"response": "This is a test response that might be long"}
        await handler._end_step(mock_step, response_payload)
        
        mock_step.stream_token.assert_called_once()
        call_args = mock_step.stream_token.call_args[0][0]
        assert "Response:" in call_args
        mock_step.__aexit__.assert_called_once_with(None, None, None)

    @pytest.mark.asyncio
    async def test_async_end_step_with_nodes(self, handler, mock_step):
        """Test async _end_step with node count payload."""
        nodes_payload = {"num_nodes": 5}
        await handler._end_step(mock_step, nodes_payload)
        
        mock_step.stream_token.assert_called_once_with("Retrieved 5 nodes")
        mock_step.__aexit__.assert_called_once_with(None, None, None)