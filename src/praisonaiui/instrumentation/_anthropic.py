"""Anthropic client instrumentation.

Patches anthropic.Anthropic.messages.create to emit Step events.
"""

from __future__ import annotations

import time
from functools import wraps
from typing import Any, Dict, Optional, TYPE_CHECKING

from ._base import _emit_llm_step, _is_instrumentation_enabled

# Import for patching (needed for tests)
try:
    import anthropic
except ImportError:
    anthropic = None

if TYPE_CHECKING:
    import anthropic

# Track if we've already instrumented
_INSTRUMENTED = False


def instrument_anthropic() -> None:
    """Instrument Anthropic client to emit Steps for all message calls.
    
    Patches:
    - anthropic.Anthropic.messages.create (sync)
    - anthropic.AsyncAnthropic.messages.create (async)
    - Stream handling for both sync and async
    
    Example:
        aiui.instrument_anthropic()
        
        # Now all calls are automatically tracked
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(...)  # Step emitted!
    """
    global _INSTRUMENTED
    
    if _INSTRUMENTED:
        return  # Idempotent
        
    if anthropic is None:
        try:
            import anthropic as anthropic_module
        except ImportError:
            # Anthropic not installed - silently skip
            return
    else:
        anthropic_module = anthropic
        
    # Patch sync client
    _patch_sync_client(anthropic_module)
    
    # Patch async client  
    _patch_async_client(anthropic_module)
    
    _INSTRUMENTED = True


def _patch_sync_client(anthropic_module) -> None:
    """Patch synchronous Anthropic client."""
    
    def instrumented_create(original_create):
        @wraps(original_create)
        def wrapper(self, **kwargs):
            if not _is_instrumentation_enabled():
                return original_create(self, **kwargs)
                
            start_time = time.time()
            model = kwargs.get("model", "unknown")
            
            try:
                response = original_create(self, **kwargs)
                
                # Handle streaming response
                if kwargs.get("stream", False):
                    return _wrap_sync_stream(response, model, kwargs, start_time)
                else:
                    # Regular response
                    latency_ms = (time.time() - start_time) * 1000
                    _emit_sync_step(model, kwargs, response, latency_ms)
                    return response
                    
            except Exception as e:
                latency_ms = (time.time() - start_time) * 1000
                _emit_sync_step(model, kwargs, None, latency_ms, error=str(e))
                raise
        return wrapper
    
    # Try to patch the resource class (production usage)
    try:
        from anthropic.resources.messages import Messages
        original_create = Messages.create
        Messages.create = instrumented_create(original_create)
    except (ImportError, AttributeError):
        # Fall back to class-level patching (for tests)
        try:
            if hasattr(anthropic_module, 'Anthropic') and hasattr(anthropic_module.Anthropic, 'messages'):
                # This approach works for mock objects in tests
                original_create = anthropic_module.Anthropic.messages.create
                anthropic_module.Anthropic.messages.create = instrumented_create(original_create)
        except AttributeError:
            pass  # Skip if structure doesn't match


def _patch_async_client(anthropic_module) -> None:
    """Patch asynchronous Anthropic client."""
    
    def instrumented_async_create(original_create):
        @wraps(original_create)
        async def wrapper(self, **kwargs):
            if not _is_instrumentation_enabled():
                return await original_create(self, **kwargs)
                
            start_time = time.time()
            model = kwargs.get("model", "unknown")
            
            try:
                response = await original_create(self, **kwargs)
                
                # Handle streaming response
                if kwargs.get("stream", False):
                    return _wrap_async_stream(response, model, kwargs, start_time)
                else:
                    # Regular response
                    latency_ms = (time.time() - start_time) * 1000
                    await _emit_async_step(model, kwargs, response, latency_ms)
                    return response
                    
            except Exception as e:
                latency_ms = (time.time() - start_time) * 1000
                await _emit_async_step(model, kwargs, None, latency_ms, error=str(e))
                raise
        return wrapper
    
    # Try to patch the resource class (production usage)
    try:
        from anthropic.resources.messages import AsyncMessages
        original_create = AsyncMessages.create
        AsyncMessages.create = instrumented_async_create(original_create)
    except (ImportError, AttributeError):
        # Fall back to class-level patching (for tests)
        try:
            if hasattr(anthropic_module, 'AsyncAnthropic') and hasattr(anthropic_module.AsyncAnthropic, 'messages'):
                # This approach works for mock objects in tests
                original_create = anthropic_module.AsyncAnthropic.messages.create
                anthropic_module.AsyncAnthropic.messages.create = instrumented_async_create(original_create)
        except AttributeError:
            pass  # Skip if structure doesn't match


def _wrap_sync_stream(stream, model: str, request_data: Dict[str, Any], start_time: float):
    """Wrap sync streaming response to collect tokens."""
    accumulated_content = ""
    input_tokens = 0
    output_tokens = 0
    
    for chunk in stream:
        if hasattr(chunk, 'delta') and chunk.delta:
            if hasattr(chunk.delta, 'text') and chunk.delta.text:
                accumulated_content += chunk.delta.text
                output_tokens += 1  # Rough approximation
                
        # Check for usage info in message_stop event
        if hasattr(chunk, 'usage') and chunk.usage:
            input_tokens = getattr(chunk.usage, 'input_tokens', 0)
            output_tokens = getattr(chunk.usage, 'output_tokens', 0)
            
        yield chunk
        
    # Emit step after stream completes
    latency_ms = (time.time() - start_time) * 1000
    output_data = {"content": accumulated_content} if accumulated_content else {}
    
    # Run async emission in sync context (best effort)
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_emit_llm_step(
                provider="anthropic",
                model=model,
                input_data=request_data,
                output_data=output_data,
                tokens_in=input_tokens,
                tokens_out=output_tokens,
                latency_ms=latency_ms,
            ))
    except Exception:
        pass  # Silently fail


async def _wrap_async_stream(stream, model: str, request_data: Dict[str, Any], start_time: float):
    """Wrap async streaming response to collect tokens."""
    accumulated_content = ""
    input_tokens = 0
    output_tokens = 0
    
    async for chunk in stream:
        if hasattr(chunk, 'delta') and chunk.delta:
            if hasattr(chunk.delta, 'text') and chunk.delta.text:
                accumulated_content += chunk.delta.text
                output_tokens += 1  # Rough approximation
                
        # Check for usage info in message_stop event
        if hasattr(chunk, 'usage') and chunk.usage:
            input_tokens = getattr(chunk.usage, 'input_tokens', 0)
            output_tokens = getattr(chunk.usage, 'output_tokens', 0)
            
        yield chunk
        
    # Emit step after stream completes
    latency_ms = (time.time() - start_time) * 1000
    output_data = {"content": accumulated_content} if accumulated_content else {}
    
    await _emit_llm_step(
        provider="anthropic",
        model=model,
        input_data=request_data,
        output_data=output_data,
        tokens_in=input_tokens,
        tokens_out=output_tokens,
        latency_ms=latency_ms,
    )


def _emit_sync_step(
    model: str, 
    request_data: Dict[str, Any], 
    response: Optional[Any], 
    latency_ms: float,
    error: Optional[str] = None
) -> None:
    """Emit step for sync call (best effort async)."""
    try:
        import asyncio
        
        # Extract token counts and response data
        tokens_in = 0
        tokens_out = 0
        output_data = {}
        
        if response and hasattr(response, 'usage') and response.usage:
            tokens_in = getattr(response.usage, 'input_tokens', 0)
            tokens_out = getattr(response.usage, 'output_tokens', 0)
            
        if response and hasattr(response, 'content') and response.content:
            # Anthropic content is a list of content blocks
            content_text = ""
            for block in response.content:
                if hasattr(block, 'text'):
                    content_text += block.text
            output_data = {"content": content_text}
        
        # Try to run in current event loop
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_emit_llm_step(
                provider="anthropic",
                model=model,
                input_data=request_data,
                output_data=output_data,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                latency_ms=latency_ms,
                error=error,
            ))
    except Exception:
        pass  # Silently fail


async def _emit_async_step(
    model: str, 
    request_data: Dict[str, Any], 
    response: Optional[Any], 
    latency_ms: float,
    error: Optional[str] = None
) -> None:
    """Emit step for async call."""
    # Extract token counts and response data
    tokens_in = 0
    tokens_out = 0
    output_data = {}
    
    if response and hasattr(response, 'usage') and response.usage:
        tokens_in = getattr(response.usage, 'input_tokens', 0)
        tokens_out = getattr(response.usage, 'output_tokens', 0)
        
    if response and hasattr(response, 'content') and response.content:
        # Anthropic content is a list of content blocks
        content_text = ""
        for block in response.content:
            if hasattr(block, 'text'):
                content_text += block.text
        output_data = {"content": content_text}
    
    await _emit_llm_step(
        provider="anthropic",
        model=model,
        input_data=request_data,
        output_data=output_data,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=latency_ms,
        error=error,
    )