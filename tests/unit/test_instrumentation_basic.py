"""Basic tests for LLM instrumentation functionality."""

import pytest
from unittest.mock import patch, Mock

from praisonaiui.instrumentation._base import no_instrument, _is_instrumentation_enabled
from praisonaiui.instrumentation import (
    instrument_openai, 
    instrument_anthropic, 
    instrument_mistral, 
    instrument_google
)


def test_no_instrument_context_disables_tracking():
    """Test that no_instrument context manager disables tracking."""
    # Initially enabled
    assert _is_instrumentation_enabled() is True
    
    # Disabled within context
    with no_instrument():
        assert _is_instrumentation_enabled() is False
    
    # Enabled again after context
    assert _is_instrumentation_enabled() is True


def test_no_instrument_context_is_reentrant():
    """Test that no_instrument contexts can be nested."""
    assert _is_instrumentation_enabled() is True
    
    with no_instrument():
        assert _is_instrumentation_enabled() is False
        
        with no_instrument():
            assert _is_instrumentation_enabled() is False
            
        assert _is_instrumentation_enabled() is False
    
    assert _is_instrumentation_enabled() is True


def test_instrument_functions_handle_missing_imports():
    """Test that instrumentation functions gracefully handle missing imports."""
    # These should not raise even when the underlying libraries are not installed
    # (which is the case in this test environment)
    instrument_openai()
    instrument_anthropic() 
    instrument_mistral()
    instrument_google()


def test_instrumentation_functions_are_idempotent():
    """Test that instrumentation functions can be called multiple times safely."""
    # These should not raise even if called multiple times
    instrument_openai()
    instrument_openai()
    
    instrument_anthropic()
    instrument_anthropic()
    
    instrument_mistral()
    instrument_mistral()
    
    instrument_google()
    instrument_google()


def test_instrumentation_imports():
    """Test that instrumentation functions can be imported from main package."""
    # Test that lazy imports work
    import praisonaiui as aiui
    
    # These should be available
    assert hasattr(aiui, 'instrument_openai')
    assert hasattr(aiui, 'instrument_anthropic')
    assert hasattr(aiui, 'instrument_mistral')
    assert hasattr(aiui, 'instrument_google')
    assert hasattr(aiui, 'no_instrument')
    assert hasattr(aiui, 'get_token_usage')
    
    # Functions should be callable
    assert callable(aiui.instrument_openai)
    assert callable(aiui.no_instrument)
    assert callable(aiui.get_token_usage)


def test_get_token_usage_returns_correct_structure():
    """Test that get_token_usage returns the expected structure."""
    import praisonaiui as aiui
    
    # Should return empty structure for unknown session
    result = aiui.get_token_usage("unknown-session")
    
    expected_keys = {
        "session_id", "total_input_tokens", "total_output_tokens", 
        "total_tokens", "total_cost", "requests"
    }
    
    assert set(result.keys()) == expected_keys
    assert result["session_id"] == "unknown-session"
    assert result["total_input_tokens"] == 0
    assert result["total_output_tokens"] == 0
    assert result["total_tokens"] == 0
    assert result["total_cost"] == 0.0
    assert result["requests"] == 0


def test_emit_llm_step_handles_missing_context():
    """Test that _emit_llm_step gracefully handles missing context."""
    # Import asyncio to run the async function
    import asyncio
    from praisonaiui.instrumentation._base import _emit_llm_step
    
    async def test_async():
        # Should not raise even when no context is set (which is the default case)
        await _emit_llm_step(
            provider="test",
            model="test-model", 
            input_data={"test": "input"},
            output_data={"test": "output"},
            tokens_in=10,
            tokens_out=20,
        )
    
    # Run the async test - this should pass without raising
    asyncio.run(test_async())


def test_format_input_handles_various_formats():
    """Test that input formatting works with different data structures."""
    from praisonaiui.instrumentation._base import _format_input
    
    # Messages format
    messages_data = {"messages": [{"role": "user", "content": "Hello world"}]}
    result = _format_input(messages_data)
    assert "user" in result
    assert "Hello world" in result
    
    # Prompt format
    prompt_data = {"prompt": "What is the meaning of life?"}
    result = _format_input(prompt_data)
    assert "Prompt:" in result
    assert "meaning of life" in result
    
    # Text format
    text_data = {"text": "Analyze this text"}
    result = _format_input(text_data)
    assert "Text:" in result
    assert "Analyze" in result
    
    # Long content truncation
    long_data = {"prompt": "x" * 200}
    result = _format_input(long_data)
    assert len(result) <= 113  # Allow some tolerance for "Prompt: " + "..."


def test_format_output_handles_various_formats():
    """Test that output formatting works with different data structures."""
    from praisonaiui.instrumentation._base import _format_output
    
    # Content format
    content_data = {"content": "This is the response"}
    result = _format_output(content_data)
    assert "This is the response" in result
    
    # Choices format (OpenAI style)
    choices_data = {
        "choices": [{"message": {"content": "Generated text"}}]
    }
    result = _format_output(choices_data)
    assert "Generated text" in result
    
    # Long content truncation
    long_data = {"content": "x" * 300}
    result = _format_output(long_data)
    assert len(result) <= 203  # 200 + "..."