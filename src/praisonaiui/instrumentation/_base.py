"""Base functionality for LLM instrumentation.

Provides shared Step emission logic and context management for opt-out.
"""

from __future__ import annotations

import time
from contextvars import ContextVar
from contextlib import asynccontextmanager, contextmanager
from typing import Any, Dict, Optional, AsyncGenerator, Generator

# Context variable for opt-out control
_INSTRUMENTATION_ENABLED: ContextVar[bool] = ContextVar("instrumentation_enabled", default=True)


def _is_instrumentation_enabled() -> bool:
    """Check if instrumentation is currently enabled."""
    return _INSTRUMENTATION_ENABLED.get(True)


@contextmanager
def no_instrument() -> Generator[None, None, None]:
    """Context manager to disable instrumentation for specific calls.
    
    Example:
        with aiui.no_instrument():
            # This call won't be tracked
            await openai.ChatCompletion.create(...)
    """
    token = _INSTRUMENTATION_ENABLED.set(False)
    try:
        yield
    finally:
        _INSTRUMENTATION_ENABLED.reset(token)


async def _emit_llm_step(
    provider: str,
    model: str,
    input_data: Dict[str, Any],
    output_data: Dict[str, Any],
    tokens_in: int = 0,
    tokens_out: int = 0,
    latency_ms: Optional[float] = None,
    error: Optional[str] = None,
) -> None:
    """Emit a Step event for an LLM call.
    
    Args:
        provider: LLM provider name (openai, anthropic, mistral, google)
        model: Model name
        input_data: Request data (prompt, messages, etc.)
        output_data: Response data 
        tokens_in: Input token count
        tokens_out: Output token count
        latency_ms: Request latency in milliseconds
        error: Error message if call failed
    """
    if not _is_instrumentation_enabled():
        return
        
    try:
        # Lazy import to avoid circular dependency
        from praisonaiui.message import Step
        from praisonaiui.features.usage import track_usage
        from praisonaiui.callbacks import _get_context
        
        # Get current context
        context = _get_context()
        if not context:
            return
            
        # Build step name and metadata
        step_name = f"🤖 {provider.title()}: {model}"
        metadata = {
            "provider": provider,
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "type": "llm_call",
        }
        
        if latency_ms is not None:
            metadata["latency_ms"] = round(latency_ms, 2)
            
        if error:
            metadata["error"] = error
            
        # Create and emit Step
        async with Step(name=step_name, type="tool_call", metadata=metadata) as step:
            # Show input
            if input_data:
                await step.stream_token(f"Input: {_format_input(input_data)}\n")
                
            # Show output or error
            if error:
                await step.stream_token(f"Error: {error}")
            elif output_data:
                await step.stream_token(f"Output: {_format_output(output_data)}")
                
        # Track usage if tokens available
        if tokens_in > 0 or tokens_out > 0:
            session_id = getattr(context, 'session_id', 'unknown')
            track_usage(
                model=model,
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                session_id=session_id,
                agent_name=f"{provider}_instrumentation",
            )
            
    except Exception:
        # Silently fail - instrumentation should not break user code
        pass


def _format_input(input_data: Dict[str, Any]) -> str:
    """Format input data for display in Step."""
    if "messages" in input_data:
        messages = input_data["messages"]
        if isinstance(messages, list) and messages:
            # Show last user message
            for msg in reversed(messages):
                if isinstance(msg, dict) and msg.get("role") == "user":
                    content = msg.get("content", "")
                    if len(str(content)) > 100:
                        content = str(content)[:100] + "..."
                    return f"Messages: [{msg['role']}]: {content}"
            return f"Messages: {len(messages)} messages"
    elif "prompt" in input_data:
        prompt = str(input_data["prompt"])
        if len(prompt) > 100:
            prompt = prompt[:100] + "..."
        return f"Prompt: {prompt}"
    elif "text" in input_data:
        text = str(input_data["text"])
        if len(text) > 100:
            text = text[:100] + "..."
        return f"Text: {text}"
    else:
        # Generic fallback
        return str(input_data)[:100] + ("..." if len(str(input_data)) > 100 else "")


def _format_output(output_data: Dict[str, Any]) -> str:
    """Format output data for display in Step."""
    if "content" in output_data:
        content = str(output_data["content"])
        if len(content) > 200:
            content = content[:200] + "..."
        return content
    elif "text" in output_data:
        text = str(output_data["text"])
        if len(text) > 200:
            text = text[:200] + "..."
        return text
    elif "choices" in output_data:
        choices = output_data["choices"]
        if isinstance(choices, list) and choices:
            choice = choices[0]
            if isinstance(choice, dict):
                message = choice.get("message", {})
                if isinstance(message, dict):
                    content = message.get("content", "")
                    if len(str(content)) > 200:
                        content = str(content)[:200] + "..."
                    return str(content)
        return f"Generated {len(choices)} choices"
    else:
        # Generic fallback
        return str(output_data)[:200] + ("..." if len(str(output_data)) > 200 else "")