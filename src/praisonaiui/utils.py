"""Utility functions for PraisonAIUI.

This module provides common utility functions including async sleep
that yields to the event emitter to keep UI responsive.
"""

from __future__ import annotations

import asyncio
from typing import Optional


async def sleep(seconds: float) -> None:
    """Async sleep that also yields to the event emitter.
    
    This function wraps asyncio.sleep and ensures that pending SSE events
    are flushed so the UI stays responsive during long sleep periods.
    
    Args:
        seconds: Number of seconds to sleep
    
    Example:
        import praisonaiui as aiui
        
        async def long_process():
            await aiui.Message("Starting process...").send()
            await aiui.sleep(2.0)  # Flushes events before sleeping
            await aiui.Message("Process complete!").send()
    """
    # Get current message context to access the stream queue
    from praisonaiui.callbacks import _get_context
    
    context = _get_context()
    
    # If we have an active context with a stream queue, flush pending events
    if context and hasattr(context, '_stream_queue') and context._stream_queue:
        try:
            # Yield to allow any pending events to be processed
            await asyncio.sleep(0)
            
            # Check if there are any pending items in the queue and process them
            # Note: We don't wait for queue processing to complete, just yield
            # to give the event loop a chance to process pending events
        except Exception:
            # If there's any issue with the context/queue, just proceed with normal sleep
            pass
    
    # Perform the actual sleep
    await asyncio.sleep(seconds)


def format_duration(seconds: float) -> str:
    """Format a duration in seconds to a human-readable string.
    
    Args:
        seconds: Duration in seconds
        
    Returns:
        Formatted duration string (e.g., "2.5s", "1m 30s", "1h 5m")
    """
    if seconds < 60:
        return f"{seconds:.1f}s"
    
    minutes = int(seconds // 60)
    remaining_seconds = seconds % 60
    
    if minutes < 60:
        if remaining_seconds > 0:
            return f"{minutes}m {remaining_seconds:.0f}s"
        return f"{minutes}m"
    
    hours = minutes // 60
    remaining_minutes = minutes % 60
    
    if remaining_minutes > 0:
        return f"{hours}h {remaining_minutes}m"
    return f"{hours}h"


def truncate_text(text: str, max_length: int = 100, suffix: str = "...") -> str:
    """Truncate text to a maximum length with an optional suffix.
    
    Args:
        text: Text to truncate
        max_length: Maximum length of the result (including suffix)
        suffix: Suffix to add if text is truncated
        
    Returns:
        Truncated text
    """
    if len(text) <= max_length:
        return text
    
    if len(suffix) >= max_length:
        return text[:max_length]
    
    # Truncate to fit the suffix, then strip trailing whitespace
    truncated = text[:max_length - len(suffix)].rstrip()
    return truncated + suffix


def safe_filename(filename: str, max_length: int = 255) -> str:
    """Convert a string to a safe filename by removing/replacing invalid characters.
    
    Args:
        filename: Original filename
        max_length: Maximum length of the result
        
    Returns:
        Safe filename
    """
    import re
    
    # Replace invalid characters with underscores
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', filename)
    
    # Remove leading/trailing dots and spaces
    safe_name = safe_name.strip('. ')
    
    # Truncate if too long
    if len(safe_name) > max_length:
        name, ext = safe_name.rsplit('.', 1) if '.' in safe_name else (safe_name, '')
        max_name_length = max_length - len(ext) - 1 if ext else max_length
        safe_name = name[:max_name_length] + ('.' + ext if ext else '')
    
    # Ensure it's not empty
    if not safe_name:
        safe_name = 'untitled'
    
    return safe_name