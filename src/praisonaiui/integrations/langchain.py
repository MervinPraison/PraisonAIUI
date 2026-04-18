"""LangChain integration for PraisonAIUI.

Provides sync and async callback handlers that map LangChain events
to aiui.Step events for rich UI visualization.
"""

import asyncio
import time
from typing import Any, Dict, List, Optional, Union

from praisonaiui.message import Step, StepType


class AiuiLangChainCallbackHandler:
    """LangChain callback handler that creates aiui.Step events.
    
    Maps LangChain chain/tool/agent events to nested Step visualization.
    Handles both sync and async execution safely.
    
    Example:
        from langchain.chat_models import ChatOpenAI
        from praisonaiui.integrations.langchain import AiuiLangChainCallbackHandler
        
        llm = ChatOpenAI(callbacks=[AiuiLangChainCallbackHandler()])
        response = llm.invoke("Hello world")
        # LLM call appears as nested Step in aiui
    """

    def __init__(self):
        """Initialize the callback handler."""
        self._step_stack: List[Step] = []
        self._run_id_to_step: Dict[str, Step] = {}
        
    def on_chain_start(
        self, 
        serialized: Dict[str, Any], 
        inputs: Dict[str, Any], 
        **kwargs: Any
    ) -> None:
        """Handle chain start event."""
        run_id = kwargs.get("run_id")
        if not run_id:
            return
            
        chain_name = serialized.get("name", serialized.get("id", ["unknown"]))
        if isinstance(chain_name, list):
            chain_name = chain_name[-1] if chain_name else "unknown"
            
        parent_step = self._step_stack[-1] if self._step_stack else None
        step = Step(
            name=f"🔗 Chain: {chain_name}",
            type="reasoning",
            parent=parent_step,
            metadata={"inputs": inputs, "serialized": serialized}
        )
        
        self._step_stack.append(step)
        self._run_id_to_step[str(run_id)] = step
        
        # Start step in async context if possible
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(step.__aenter__())
        except RuntimeError:
            # No event loop running - step will start when used in async context
            pass

    def on_chain_end(self, outputs: Dict[str, Any], **kwargs: Any) -> None:
        """Handle chain end event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        
        # End step in async context if possible
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(step.__aexit__(None, None, None))
        except RuntimeError:
            pass
            
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    def on_chain_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any) -> None:
        """Handle chain error event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        
        # End step with error in async context if possible
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(step.__aexit__(type(error), error, None))
        except RuntimeError:
            pass
            
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    def on_llm_start(
        self, 
        serialized: Dict[str, Any], 
        prompts: List[str], 
        **kwargs: Any
    ) -> None:
        """Handle LLM start event."""
        run_id = kwargs.get("run_id")
        if not run_id:
            return
            
        model_name = serialized.get("name", "LLM")
        parent_step = self._step_stack[-1] if self._step_stack else None
        
        step = Step(
            name=f"🤖 LLM: {model_name}",
            type="reasoning", 
            parent=parent_step,
            metadata={"prompts": prompts, "serialized": serialized}
        )
        
        self._step_stack.append(step)
        self._run_id_to_step[str(run_id)] = step
        
        # Start step and stream prompt
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(self._start_llm_step(step, prompts))
        except RuntimeError:
            pass

    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        """Handle LLM token streaming."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(step.stream_token(token))
        except RuntimeError:
            pass

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        """Handle LLM end event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(step.__aexit__(None, None, None))
        except RuntimeError:
            pass
            
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    def on_llm_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any) -> None:
        """Handle LLM error event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(step.__aexit__(type(error), error, None))
        except RuntimeError:
            pass
            
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    def on_tool_start(
        self, 
        serialized: Dict[str, Any], 
        input_str: str, 
        **kwargs: Any
    ) -> None:
        """Handle tool start event."""
        run_id = kwargs.get("run_id")
        if not run_id:
            return
            
        tool_name = serialized.get("name", "Tool")
        parent_step = self._step_stack[-1] if self._step_stack else None
        
        step = Step(
            name=f"🔧 Tool: {tool_name}",
            type="tool_call",
            parent=parent_step,
            metadata={"input": input_str, "serialized": serialized}
        )
        
        self._step_stack.append(step)
        self._run_id_to_step[str(run_id)] = step
        
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(self._start_tool_step(step, input_str))
        except RuntimeError:
            pass

    def on_tool_end(self, output: str, **kwargs: Any) -> None:
        """Handle tool end event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(self._end_tool_step(step, output))
        except RuntimeError:
            pass
            
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    def on_tool_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any) -> None:
        """Handle tool error event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(step.__aexit__(type(error), error, None))
        except RuntimeError:
            pass
            
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    def on_agent_action(self, action: Any, **kwargs: Any) -> None:
        """Handle agent action event."""
        run_id = kwargs.get("run_id")
        if not run_id:
            return
            
        parent_step = self._step_stack[-1] if self._step_stack else None
        
        step = Step(
            name=f"🎯 Agent Action: {getattr(action, 'tool', 'unknown')}",
            type="sub_agent",
            parent=parent_step,
            metadata={"action": str(action)}
        )
        
        self._step_stack.append(step)
        self._run_id_to_step[str(run_id)] = step
        
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(self._start_agent_action(step, action))
        except RuntimeError:
            pass

    def on_agent_finish(self, finish: Any, **kwargs: Any) -> None:
        """Handle agent finish event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(self._end_agent_action(step, finish))
        except RuntimeError:
            pass
            
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    async def _start_llm_step(self, step: Step, prompts: List[str]) -> None:
        """Start LLM step with prompt display."""
        await step.__aenter__()
        if prompts:
            await step.stream_token(f"Prompt: {prompts[0][:200]}...")

    async def _start_tool_step(self, step: Step, input_str: str) -> None:
        """Start tool step with input display."""
        await step.__aenter__()
        await step.stream_token(f"Input: {input_str}")

    async def _end_tool_step(self, step: Step, output: str) -> None:
        """End tool step with output display."""
        await step.stream_token(f"Output: {output}")
        await step.__aexit__(None, None, None)

    async def _start_agent_action(self, step: Step, action: Any) -> None:
        """Start agent action step."""
        await step.__aenter__()
        await step.stream_token(f"Action: {action}")

    async def _end_agent_action(self, step: Step, finish: Any) -> None:
        """End agent action step."""
        await step.stream_token(f"Result: {finish}")
        await step.__aexit__(None, None, None)


class AsyncAiuiLangChainCallbackHandler:
    """Async LangChain callback handler that creates aiui.Step events.
    
    Designed for async LangChain workflows with proper async/await patterns.
    
    Example:
        from langchain.chat_models import ChatOpenAI
        from praisonaiui.integrations.langchain import AsyncAiuiLangChainCallbackHandler
        
        llm = ChatOpenAI(callbacks=[AsyncAiuiLangChainCallbackHandler()])
        response = await llm.ainvoke("Hello world")
        # LLM call appears as nested Step in aiui
    """

    def __init__(self):
        """Initialize the async callback handler."""
        self._step_stack: List[Step] = []
        self._run_id_to_step: Dict[str, Step] = {}

    async def on_chain_start(
        self, 
        serialized: Dict[str, Any], 
        inputs: Dict[str, Any], 
        **kwargs: Any
    ) -> None:
        """Handle chain start event."""
        run_id = kwargs.get("run_id")
        if not run_id:
            return
            
        chain_name = serialized.get("name", serialized.get("id", ["unknown"]))
        if isinstance(chain_name, list):
            chain_name = chain_name[-1] if chain_name else "unknown"
            
        parent_step = self._step_stack[-1] if self._step_stack else None
        step = Step(
            name=f"🔗 Chain: {chain_name}",
            type="reasoning",
            parent=parent_step,
            metadata={"inputs": inputs, "serialized": serialized}
        )
        
        self._step_stack.append(step)
        self._run_id_to_step[str(run_id)] = step
        await step.__aenter__()

    async def on_chain_end(self, outputs: Dict[str, Any], **kwargs: Any) -> None:
        """Handle chain end event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        await step.__aexit__(None, None, None)
        
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    async def on_chain_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any) -> None:
        """Handle chain error event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        await step.__aexit__(type(error), error, None)
        
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    async def on_llm_start(
        self, 
        serialized: Dict[str, Any], 
        prompts: List[str], 
        **kwargs: Any
    ) -> None:
        """Handle LLM start event."""
        run_id = kwargs.get("run_id")
        if not run_id:
            return
            
        model_name = serialized.get("name", "LLM")
        parent_step = self._step_stack[-1] if self._step_stack else None
        
        step = Step(
            name=f"🤖 LLM: {model_name}",
            type="reasoning",
            parent=parent_step,
            metadata={"prompts": prompts, "serialized": serialized}
        )
        
        self._step_stack.append(step)
        self._run_id_to_step[str(run_id)] = step
        
        await step.__aenter__()
        if prompts:
            await step.stream_token(f"Prompt: {prompts[0][:200]}...")

    async def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        """Handle LLM token streaming."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        await step.stream_token(token)

    async def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        """Handle LLM end event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        await step.__aexit__(None, None, None)
        
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    async def on_llm_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any) -> None:
        """Handle LLM error event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        await step.__aexit__(type(error), error, None)
        
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    async def on_tool_start(
        self, 
        serialized: Dict[str, Any], 
        input_str: str, 
        **kwargs: Any
    ) -> None:
        """Handle tool start event."""
        run_id = kwargs.get("run_id")
        if not run_id:
            return
            
        tool_name = serialized.get("name", "Tool")
        parent_step = self._step_stack[-1] if self._step_stack else None
        
        step = Step(
            name=f"🔧 Tool: {tool_name}",
            type="tool_call",
            parent=parent_step,
            metadata={"input": input_str, "serialized": serialized}
        )
        
        self._step_stack.append(step)
        self._run_id_to_step[str(run_id)] = step
        
        await step.__aenter__()
        await step.stream_token(f"Input: {input_str}")

    async def on_tool_end(self, output: str, **kwargs: Any) -> None:
        """Handle tool end event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        await step.stream_token(f"Output: {output}")
        await step.__aexit__(None, None, None)
        
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    async def on_tool_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any) -> None:
        """Handle tool error event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        await step.__aexit__(type(error), error, None)
        
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]

    async def on_agent_action(self, action: Any, **kwargs: Any) -> None:
        """Handle agent action event."""
        run_id = kwargs.get("run_id")
        if not run_id:
            return
            
        parent_step = self._step_stack[-1] if self._step_stack else None
        
        step = Step(
            name=f"🎯 Agent Action: {getattr(action, 'tool', 'unknown')}",
            type="sub_agent",
            parent=parent_step,
            metadata={"action": str(action)}
        )
        
        self._step_stack.append(step)
        self._run_id_to_step[str(run_id)] = step
        
        await step.__aenter__()
        await step.stream_token(f"Action: {action}")

    async def on_agent_finish(self, finish: Any, **kwargs: Any) -> None:
        """Handle agent finish event."""
        run_id = kwargs.get("run_id")
        if not run_id or str(run_id) not in self._run_id_to_step:
            return
            
        step = self._run_id_to_step[str(run_id)]
        await step.stream_token(f"Result: {finish}")
        await step.__aexit__(None, None, None)
        
        # Clean up
        if step in self._step_stack:
            self._step_stack.remove(step)
        del self._run_id_to_step[str(run_id)]