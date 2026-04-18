"""Google Gemini client instrumentation.

Patches google.generativeai.GenerativeModel.generate_content to emit Step events.
"""

from __future__ import annotations

import time
from functools import wraps
from typing import Any, Dict, Optional, TYPE_CHECKING

from ._base import _emit_llm_step, _is_instrumentation_enabled

if TYPE_CHECKING:
    import google.generativeai as genai

# Track if we've already instrumented
_INSTRUMENTED = False


def instrument_google() -> None:
    """Instrument Google GenerativeAI client to emit Steps for content generation calls.
    
    Patches:
    - google.generativeai.GenerativeModel.generate_content (sync)
    - google.generativeai.GenerativeModel.generate_content_async (async)
    - Stream handling for both sync and async
    
    Example:
        aiui.instrument_google()
        
        # Now all calls are automatically tracked
        import google.generativeai as genai
        model = genai.GenerativeModel('gemini-pro')
        response = model.generate_content(...)  # Step emitted!
    """
    global _INSTRUMENTED
    
    if _INSTRUMENTED:
        return  # Idempotent
        
    try:
        import google.generativeai as genai
    except ImportError:
        # Google GenAI not installed - silently skip
        return
        
    # Patch sync method
    _patch_sync_model(genai)
    
    # Patch async method
    _patch_async_model(genai)
    
    _INSTRUMENTED = True


def _patch_sync_model(genai) -> None:
    """Patch synchronous Google GenerativeModel."""
    original_generate = genai.GenerativeModel.generate_content
    
    @wraps(original_generate)
    def instrumented_generate(self, contents, **kwargs):
        if not _is_instrumentation_enabled():
            return original_generate(self, contents, **kwargs)
            
        start_time = time.time()
        model_name = getattr(self, 'model_name', 'unknown')
        
        # Build request data
        request_data = {"contents": contents, **kwargs}
        
        try:
            # Check if streaming is requested
            stream = kwargs.get('stream', False)
            
            response = original_generate(self, contents, **kwargs)
            
            if stream:
                return _wrap_sync_stream(response, model_name, request_data, start_time)
            else:
                # Regular response
                latency_ms = (time.time() - start_time) * 1000
                _emit_sync_step(model_name, request_data, response, latency_ms)
                return response
                
        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            _emit_sync_step(model_name, request_data, None, latency_ms, error=str(e))
            raise
            
    genai.GenerativeModel.generate_content = instrumented_generate


def _patch_async_model(genai) -> None:
    """Patch asynchronous Google GenerativeModel."""
    original_generate_async = genai.GenerativeModel.generate_content_async
    
    @wraps(original_generate_async)
    async def instrumented_generate_async(self, contents, **kwargs):
        if not _is_instrumentation_enabled():
            return await original_generate_async(self, contents, **kwargs)
            
        start_time = time.time()
        model_name = getattr(self, 'model_name', 'unknown')
        
        # Build request data
        request_data = {"contents": contents, **kwargs}
        
        try:
            # Check if streaming is requested
            stream = kwargs.get('stream', False)
            
            response = await original_generate_async(self, contents, **kwargs)
            
            if stream:
                return _wrap_async_stream(response, model_name, request_data, start_time)
            else:
                # Regular response
                latency_ms = (time.time() - start_time) * 1000
                await _emit_async_step(model_name, request_data, response, latency_ms)
                return response
                
        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            await _emit_async_step(model_name, request_data, None, latency_ms, error=str(e))
            raise
            
    genai.GenerativeModel.generate_content_async = instrumented_generate_async


def _wrap_sync_stream(stream, model: str, request_data: Dict[str, Any], start_time: float):
    """Wrap sync streaming response to collect tokens."""
    accumulated_content = ""
    input_tokens = 0
    output_tokens = 0
    
    for chunk in stream:
        if hasattr(chunk, 'text') and chunk.text:
            accumulated_content += chunk.text
            output_tokens += 1  # Rough approximation
            
        # Check for usage info
        if hasattr(chunk, 'usage_metadata') and chunk.usage_metadata:
            input_tokens = getattr(chunk.usage_metadata, 'prompt_token_count', 0)
            output_tokens = getattr(chunk.usage_metadata, 'candidates_token_count', 0)
            
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
                provider="google",
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
        if hasattr(chunk, 'text') and chunk.text:
            accumulated_content += chunk.text
            output_tokens += 1  # Rough approximation
            
        # Check for usage info
        if hasattr(chunk, 'usage_metadata') and chunk.usage_metadata:
            input_tokens = getattr(chunk.usage_metadata, 'prompt_token_count', 0)
            output_tokens = getattr(chunk.usage_metadata, 'candidates_token_count', 0)
            
        yield chunk
        
    # Emit step after stream completes
    latency_ms = (time.time() - start_time) * 1000
    output_data = {"content": accumulated_content} if accumulated_content else {}
    
    await _emit_llm_step(
        provider="google",
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
        
        if response and hasattr(response, 'usage_metadata') and response.usage_metadata:
            tokens_in = getattr(response.usage_metadata, 'prompt_token_count', 0)
            tokens_out = getattr(response.usage_metadata, 'candidates_token_count', 0)
            
        if response and hasattr(response, 'text') and response.text:
            output_data = {"content": response.text}
        
        # Try to run in current event loop
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_emit_llm_step(
                provider="google",
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
    
    if response and hasattr(response, 'usage_metadata') and response.usage_metadata:
        tokens_in = getattr(response.usage_metadata, 'prompt_token_count', 0)
        tokens_out = getattr(response.usage_metadata, 'candidates_token_count', 0)
        
    if response and hasattr(response, 'text') and response.text:
        output_data = {"content": response.text}
    
    await _emit_llm_step(
        provider="google",
        model=model,
        input_data=request_data,
        output_data=output_data,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=latency_ms,
        error=error,
    )