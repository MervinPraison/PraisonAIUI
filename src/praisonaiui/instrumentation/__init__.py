"""One-line LLM auto-instrumentation for major client libraries.

Provides automatic Step emission for all LLM calls with zero code changes required.

Example:
    import praisonaiui as aiui
    
    # One-line setup at app startup
    aiui.instrument_openai()
    aiui.instrument_anthropic()
    
    # Now every LLM call becomes a Step automatically
    import openai
    response = await openai.ChatCompletion.create(...)  # Auto-tracked!

Opt-out for specific calls:
    with aiui.no_instrument():
        await openai.ChatCompletion.create(...)  # Not tracked
"""

from ._base import no_instrument
from ._openai import instrument_openai
from ._anthropic import instrument_anthropic  
from ._mistral import instrument_mistral
from ._google import instrument_google

__all__ = [
    "instrument_openai",
    "instrument_anthropic", 
    "instrument_mistral",
    "instrument_google",
    "no_instrument",
]