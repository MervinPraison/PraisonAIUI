"""Mistral client instrumentation.

Patches mistralai.MistralClient.chat to emit Step events.
"""

from __future__ import annotations

import time
from functools import wraps
from typing import Any, Dict, Optional, TYPE_CHECKING

from ._base import _emit_llm_step, _is_instrumentation_enabled

if TYPE_CHECKING:
    import mistralai

# Track if we've already instrumented
_INSTRUMENTED = False


def instrument_mistral() -> None:
    """Instrument Mistral client to emit Steps for all chat calls.
    
    Patches:
    - mistralai.MistralClient.chat (sync)
    - mistralai.AsyncMistralClient.chat (async)
    - Stream handling for both sync and async
    
    Example:
        aiui.instrument_mistral()
        
        # Now all calls are automatically tracked
        import mistralai
        client = mistralai.MistralClient()
        response = client.chat(...)  # Step emitted!
    """
    global _INSTRUMENTED
    
    if _INSTRUMENTED:
        return  # Idempotent
        
    try:
        import mistralai
    except ImportError:
        # Mistral not installed - silently skip
        return
        
    # Patch sync client (legacy and modern)
    _patch_sync_client(mistralai)
    
    # Patch async client  
    _patch_async_client(mistralai)
    
    _INSTRUMENTED = True


def _patch_sync_client(mistralai) -> None:
    """Patch synchronous Mistral client."""
    # Try to patch legacy MistralClient.chat
    if hasattr(mistralai, 'MistralClient') and hasattr(mistralai.MistralClient, 'chat'):
        original_chat = mistralai.MistralClient.chat
        
        @wraps(original_chat)
        def instrumented_chat(self, **kwargs):
            if not _is_instrumentation_enabled():
                return original_chat(self, **kwargs)
                
            start_time = time.time()
            model = kwargs.get("model", "unknown")
            
            try:
                response = original_chat(self, **kwargs)
                
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
                
        mistralai.MistralClient.chat = instrumented_chat
        
    # Try to patch modern Mistral.chat.complete
    if hasattr(mistralai, 'Mistral'):
        try:
            # Modern SDK has nested resource structure
            from mistralai.resources import ChatCompletions
            original_complete = ChatCompletions.complete
            
            @wraps(original_complete)
            def instrumented_complete(self, **kwargs):
                if not _is_instrumentation_enabled():
                    return original_complete(self, **kwargs)
                    
                start_time = time.time()
                model = kwargs.get("model", "unknown")
                
                try:
                    response = original_complete(self, **kwargs)
                    
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
                    
            ChatCompletions.complete = instrumented_complete
        except ImportError:
            pass  # Modern SDK not available


def _patch_async_client(mistralai) -> None:
    """Patch asynchronous Mistral client."""
    original_chat = mistralai.AsyncMistralClient.chat
    
    @wraps(original_chat)
    async def instrumented_chat(self, **kwargs):
        if not _is_instrumentation_enabled():
            return await original_chat(self, **kwargs)
            
        start_time = time.time()
        model = kwargs.get("model", "unknown")
        
        try:
            response = await original_chat(self, **kwargs)
            
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
            
    mistralai.AsyncMistralClient.chat = instrumented_chat


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
            loop.create_task(_emit_llm_step(
                provider="mistral",
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
        provider="mistral",
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
                provider="mistral",
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
        provider="mistral",
        model=model,
        input_data=request_data,
        output_data=output_data,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=latency_ms,
        error=error,
    )