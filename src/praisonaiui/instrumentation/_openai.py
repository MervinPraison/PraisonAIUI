"""OpenAI client instrumentation.

Patches openai.OpenAI.chat.completions.create to emit Step events.
"""

from __future__ import annotations

import time
from functools import wraps
from typing import Any, Dict, Optional, TYPE_CHECKING

from ._base import _emit_llm_step, _is_instrumentation_enabled

# Import for patching (needed for tests)
try:
    import openai
except ImportError:
    openai = None

if TYPE_CHECKING:
    import openai

# Track if we've already instrumented
_INSTRUMENTED = False


def instrument_openai() -> None:
    """Instrument OpenAI client to emit Steps for all chat completion calls.
    
    Patches:
    - openai.OpenAI.chat.completions.create (sync)
    - openai.AsyncOpenAI.chat.completions.create (async)
    - Stream handling for both sync and async
    
    Example:
        aiui.instrument_openai()
        
        # Now all calls are automatically tracked
        import openai
        client = openai.OpenAI()
        response = client.chat.completions.create(...)  # Step emitted!
    """
    global _INSTRUMENTED
    
    if _INSTRUMENTED:
        return  # Idempotent
        
    if openai is None:
        try:
            import openai as openai_module
        except ImportError:
            # OpenAI not installed - silently skip
            return
    else:
        openai_module = openai
        
    # Patch sync client
    _patch_sync_client(openai_module)
    
    # Patch async client  
    _patch_async_client(openai_module)
    
    _INSTRUMENTED = True


def _patch_sync_client(openai_module) -> None:
    """Patch synchronous OpenAI client."""
    
    @wraps(lambda *args, **kwargs: None)
    def instrumented_create(original_create):
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
        from openai.resources.chat.completions import Completions
        original_create = Completions.create
        Completions.create = instrumented_create(original_create)
    except (ImportError, AttributeError):
        # Fall back to class-level patching (for tests)
        try:
            if hasattr(openai_module, 'OpenAI') and hasattr(openai_module.OpenAI, 'chat'):
                # This approach works for mock objects in tests
                original_create = openai_module.OpenAI.chat.completions.create
                openai_module.OpenAI.chat.completions.create = instrumented_create(original_create)
        except AttributeError:
            pass  # Skip if structure doesn't match


def _patch_async_client(openai_module) -> None:
    """Patch asynchronous OpenAI client."""
    
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
        from openai.resources.chat.completions import AsyncCompletions
        original_create = AsyncCompletions.create
        AsyncCompletions.create = instrumented_async_create(original_create)
    except (ImportError, AttributeError):
        # Fall back to class-level patching (for tests)
        try:
            if hasattr(openai_module, 'AsyncOpenAI') and hasattr(openai_module.AsyncOpenAI, 'chat'):
                # This approach works for mock objects in tests
                original_create = openai_module.AsyncOpenAI.chat.completions.create
                openai_module.AsyncOpenAI.chat.completions.create = instrumented_async_create(original_create)
        except AttributeError:
            pass  # Skip if structure doesn't match


def _wrap_sync_stream(stream, model: str, request_data: Dict[str, Any], start_time: float):
    """Wrap sync streaming response to collect tokens."""
    accumulated_content = ""
    input_tokens = 0
    output_tokens = 0
    
    for chunk in stream:
        if hasattr(chunk, 'choices') and chunk.choices:
            delta = chunk.choices[0].delta
            if hasattr(delta, 'content') and delta.content:
                accumulated_content += delta.content
                output_tokens += 1  # Rough approximation
                
        # Check for usage info in final chunk
        if hasattr(chunk, 'usage') and chunk.usage:
            input_tokens = getattr(chunk.usage, 'prompt_tokens', 0)
            output_tokens = getattr(chunk.usage, 'completion_tokens', 0)
            
        yield chunk
        
    # Emit step after stream completes
    latency_ms = (time.time() - start_time) * 1000
    output_data = {"content": accumulated_content} if accumulated_content else {}
    
    # Run async emission in sync context (best effort)
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Create task for later execution
            loop.create_task(_emit_llm_step(
                provider="openai",
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
        if hasattr(chunk, 'choices') and chunk.choices:
            delta = chunk.choices[0].delta
            if hasattr(delta, 'content') and delta.content:
                accumulated_content += delta.content
                output_tokens += 1  # Rough approximation
                
        # Check for usage info in final chunk
        if hasattr(chunk, 'usage') and chunk.usage:
            input_tokens = getattr(chunk.usage, 'prompt_tokens', 0)
            output_tokens = getattr(chunk.usage, 'completion_tokens', 0)
            
        yield chunk
        
    # Emit step after stream completes
    latency_ms = (time.time() - start_time) * 1000
    output_data = {"content": accumulated_content} if accumulated_content else {}
    
    await _emit_llm_step(
        provider="openai",
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
            tokens_in = getattr(response.usage, 'prompt_tokens', 0)
            tokens_out = getattr(response.usage, 'completion_tokens', 0)
            
        if response and hasattr(response, 'choices') and response.choices:
            choice = response.choices[0]
            if hasattr(choice, 'message') and choice.message:
                output_data = {"content": getattr(choice.message, 'content', '')}
        
        # Try to run in current event loop
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_emit_llm_step(
                provider="openai",
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
        tokens_in = getattr(response.usage, 'prompt_tokens', 0)
        tokens_out = getattr(response.usage, 'completion_tokens', 0)
        
    if response and hasattr(response, 'choices') and response.choices:
        choice = response.choices[0]
        if hasattr(choice, 'message') and choice.message:
            output_data = {"content": getattr(choice.message, 'content', '')}
    
    await _emit_llm_step(
        provider="openai",
        model=model,
        input_data=request_data,
        output_data=output_data,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=latency_ms,
        error=error,
    )