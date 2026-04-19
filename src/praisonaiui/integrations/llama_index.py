"""LlamaIndex integration for PraisonAIUI.

Provides callback handler that maps LlamaIndex events to aiui.Step events.
"""

import asyncio
import uuid
from typing import Any, Dict, List, Optional

from praisonaiui.message import Step, StepType


class AiuiLlamaIndexCallbackHandler:
    """LlamaIndex callback handler that creates aiui.Step events.

    Maps LlamaIndex query/retrieval/synthesis events to nested Step visualization.

    Example:
        from llama_index.core.callbacks import CallbackManager
        from praisonaiui.integrations.llama_index import AiuiLlamaIndexCallbackHandler

        Settings.callback_manager = CallbackManager([AiuiLlamaIndexCallbackHandler()])

        # All LlamaIndex operations now appear as Steps
        response = index.as_query_engine().query("What is the main topic?")
    """

    def __init__(self):
        """Initialize the LlamaIndex callback handler."""
        self._event_id_to_step: Dict[str, Step] = {}
        self._parent_map: Dict[str, str] = {}  # event_id -> parent_event_id

    def on_event_start(
        self, event_type: str, payload: Optional[Dict[str, Any]] = None, **kwargs: Any
    ) -> str:
        """Handle event start - returns event_id for tracking."""
        event_id = kwargs.get("event_id", str(uuid.uuid4()))

        # Map LlamaIndex event types to Step types and names
        if event_type == "query":
            step_name = "🔍 Query Engine"
            step_type: StepType = "reasoning"
        elif event_type == "retrieve":
            step_name = "📚 Retrieval"
            step_type = "retrieval"
        elif event_type == "synthesize":
            step_name = "🧠 Synthesis"
            step_type = "reasoning"
        elif event_type == "llm":
            step_name = "🤖 LLM Call"
            step_type = "reasoning"
        elif event_type == "embedding":
            step_name = "🔢 Embedding"
            step_type = "custom"
        elif event_type == "chunking":
            step_name = "📄 Chunking"
            step_type = "custom"
        elif event_type == "node_parsing":
            step_name = "🔗 Node Parsing"
            step_type = "custom"
        elif event_type.startswith("tool"):
            step_name = f"🔧 Tool: {event_type}"
            step_type = "tool_call"
        else:
            step_name = f"⚙️ {event_type.title()}"
            step_type = "custom"

        # Use parent_id from kwargs if available for proper nesting
        parent_id = kwargs.get("parent_id")
        parent_step = None
        if parent_id and str(parent_id) in self._event_id_to_step:
            parent_step = self._event_id_to_step[str(parent_id)]
            self._parent_map[str(event_id)] = str(parent_id)

        step = Step(
            name=step_name,
            type=step_type,
            parent=parent_step,
            metadata={"event_type": event_type, "payload": payload or {}},
        )

        self._event_id_to_step[str(event_id)] = step

        # Start step in async context if possible
        try:
            asyncio.get_running_loop()
            asyncio.create_task(self._start_step(step, payload))
        except RuntimeError:
            # No event loop running
            pass

        return str(event_id)

    def on_event_end(
        self,
        event_type: str,
        payload: Optional[Dict[str, Any]] = None,
        event_id: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """Handle event end."""
        if not event_id or str(event_id) not in self._event_id_to_step:
            return

        step = self._event_id_to_step[str(event_id)]

        try:
            asyncio.get_running_loop()
            asyncio.create_task(self._end_step(step, payload))
        except RuntimeError:
            pass

        # Clean up
        if str(event_id) in self._event_id_to_step:
            del self._event_id_to_step[str(event_id)]
        if str(event_id) in self._parent_map:
            del self._parent_map[str(event_id)]

    def on_event_error(
        self, event_type: str, exception: Exception, event_id: Optional[str] = None, **kwargs: Any
    ) -> None:
        """Handle event error."""
        if not event_id or str(event_id) not in self._event_id_to_step:
            return

        step = self._event_id_to_step[str(event_id)]

        try:
            asyncio.get_running_loop()
            asyncio.create_task(step.__aexit__(type(exception), exception, None))
        except RuntimeError:
            pass

        # Clean up
        if str(event_id) in self._event_id_to_step:
            del self._event_id_to_step[str(event_id)]
        if str(event_id) in self._parent_map:
            del self._parent_map[str(event_id)]

    # LlamaIndex callback methods (older interface compatibility)
    def start_trace(self, trace_id: Optional[str] = None) -> None:
        """Start a new trace - LlamaIndex legacy method."""
        pass

    def end_trace(
        self,
        trace_id: Optional[str] = None,
        trace_map: Optional[Dict[str, List[str]]] = None,
    ) -> None:
        """End a trace - LlamaIndex legacy method."""
        pass

    def on_query_start(self, query: str, **kwargs: Any) -> str:
        """Handle query start."""
        return self.on_event_start("query", {"query": query}, **kwargs)

    def on_query_end(self, response: Any, **kwargs: Any) -> None:
        """Handle query end."""
        event_id = kwargs.get("event_id")
        payload = {"response": str(response) if response else None}
        # Remove event_id from kwargs to avoid duplication
        kwargs_without_event_id = {k: v for k, v in kwargs.items() if k != "event_id"}
        self.on_event_end("query", payload, event_id, **kwargs_without_event_id)

    def on_retrieve_start(self, query: str, **kwargs: Any) -> str:
        """Handle retrieval start."""
        return self.on_event_start("retrieve", {"query": query}, **kwargs)

    def on_retrieve_end(self, nodes: List[Any], **kwargs: Any) -> None:
        """Handle retrieval end."""
        event_id = kwargs.get("event_id")
        payload = {
            "num_nodes": len(nodes) if nodes else 0,
            "nodes": [str(node) for node in (nodes or [])[:3]],  # First 3 for brevity
        }
        # Remove event_id from kwargs to avoid duplication
        kwargs_without_event_id = {k: v for k, v in kwargs.items() if k != "event_id"}
        self.on_event_end("retrieve", payload, event_id, **kwargs_without_event_id)

    def on_llm_start(self, messages: List[Any], **kwargs: Any) -> str:
        """Handle LLM start."""
        return self.on_event_start(
            "llm", {"messages": [str(m) for m in (messages or [])]}, **kwargs
        )

    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        """Handle LLM token streaming."""
        event_id = kwargs.get("event_id")
        if not event_id or str(event_id) not in self._event_id_to_step:
            return

        step = self._event_id_to_step[str(event_id)]

        try:
            asyncio.get_running_loop()
            asyncio.create_task(step.stream_token(token))
        except RuntimeError:
            pass

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        """Handle LLM end."""
        event_id = kwargs.get("event_id")
        payload = {"response": str(response) if response else None}
        # Remove event_id from kwargs to avoid duplication
        kwargs_without_event_id = {k: v for k, v in kwargs.items() if k != "event_id"}
        self.on_event_end("llm", payload, event_id, **kwargs_without_event_id)

    async def _start_step(self, step: Step, payload: Optional[Dict[str, Any]]) -> None:
        """Start a step and optionally stream initial content."""
        await step.__aenter__()

        if payload:
            # Stream key information from payload
            if "query" in payload:
                await step.stream_token(f"Query: {payload['query']}")
            elif "messages" in payload:
                messages = payload["messages"]
                if messages:
                    await step.stream_token(f"Messages: {messages[0][:100]}...")

    async def _end_step(self, step: Step, payload: Optional[Dict[str, Any]]) -> None:
        """End a step and optionally stream final content."""
        if payload:
            # Stream key results from payload
            if "response" in payload and payload["response"]:
                await step.stream_token(f"Response: {str(payload['response'])[:200]}...")
            elif "num_nodes" in payload:
                await step.stream_token(f"Retrieved {payload['num_nodes']} nodes")

        await step.__aexit__(None, None, None)
