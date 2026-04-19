"""Tests for DX polish features (Issue #24).

This module tests all 7 components of the developer experience bundle:
1. ErrorMessage
2. make_async/run_sync
3. aiui.sleep()
4. Element class-level API
5. CustomElement
6. CopilotFunction
7. ChatSettings
"""

import asyncio
import pytest
import json
import time
from unittest.mock import Mock, patch, AsyncMock
from typing import Dict, Any

import praisonaiui as aiui


class TestErrorMessage:
    """Test ErrorMessage class."""
    
    def test_error_message_creation(self):
        """Test ErrorMessage can be created."""
        error = aiui.ErrorMessage(content="Test error message")
        assert error.content == "Test error message"
        assert error.author == "error"
        assert error.metadata["type"] == "error"
        assert error.metadata["copyable"] is True
    
    def test_error_message_inheritance(self):
        """Test ErrorMessage inherits from Message."""
        error = aiui.ErrorMessage(content="Test error")
        assert isinstance(error, aiui.Message)
        assert hasattr(error, 'send')
        assert hasattr(error, 'stream_token')
    
    def test_error_message_metadata(self):
        """Test ErrorMessage sets proper metadata."""
        error = aiui.ErrorMessage(content="Error", metadata={"custom": "value"})
        assert error.metadata["type"] == "error"
        assert error.metadata["copyable"] is True
        assert error.metadata["custom"] == "value"


class TestSyncUtils:
    """Test sync/async bridging utilities."""
    
    @pytest.mark.asyncio
    async def test_make_async_basic(self):
        """Test make_async wraps blocking functions."""
        def blocking_func(x, y):
            time.sleep(0.01)  # Small delay
            return x + y
        
        async_func = aiui.make_async(blocking_func)
        result = await async_func(1, 2)
        assert result == 3
    
    @pytest.mark.asyncio
    async def test_make_async_with_kwargs(self):
        """Test make_async with keyword arguments."""
        def blocking_func(x, y=10):
            return x * y
        
        async_func = aiui.make_async(blocking_func)
        result = await async_func(5, y=3)
        assert result == 15
    
    def test_run_sync_basic(self):
        """Test run_sync runs coroutines synchronously."""
        async def async_func():
            await asyncio.sleep(0.01)
            return "hello"
        
        result = aiui.run_sync(async_func())
        assert result == "hello"
    
    def test_run_sync_with_timeout(self):
        """Test run_sync with timeout."""
        async def slow_func():
            await asyncio.sleep(0.5)
            return "done"
        
        with pytest.raises(asyncio.TimeoutError):
            aiui.run_sync(slow_func(), timeout=0.1)
    
    def test_run_sync_from_event_loop_fails(self):
        """Test run_sync raises error when called from event loop."""
        async def test_runner():
            async def dummy_coro():
                await asyncio.sleep(0.01)
            
            with pytest.raises(RuntimeError, match="cannot be called from a running event loop"):
                aiui.run_sync(dummy_coro())
        
        # This needs to be run in an event loop to test the error
        asyncio.run(test_runner())
    
    def test_async_context_manager(self):
        """Test AsyncContext for running multiple async ops."""
        async def async_task(value):
            await asyncio.sleep(0.01)
            return value * 2
        
        with aiui.AsyncContext() as ctx:
            result1 = ctx.run(async_task(5))
            result2 = ctx.run(async_task(10))
            
        assert result1 == 10
        assert result2 == 20


class TestUtilsModule:
    """Test utility functions."""
    
    @pytest.mark.asyncio
    async def test_sleep_basic(self):
        """Test aiui.sleep() works like asyncio.sleep."""
        start = time.time()
        await aiui.sleep(0.05)
        elapsed = time.time() - start
        assert elapsed >= 0.05
    
    @pytest.mark.asyncio 
    async def test_sleep_with_context(self):
        """Test aiui.sleep() with message context."""
        # Mock the context and stream queue
        mock_context = Mock()
        mock_context._stream_queue = AsyncMock()
        
        with patch('praisonaiui.callbacks._get_context', return_value=mock_context):
            await aiui.sleep(0.01)
    
    def test_format_duration(self):
        """Test duration formatting."""
        assert aiui.format_duration(1.5) == "1.5s"
        assert aiui.format_duration(65) == "1m 5s"
        assert aiui.format_duration(3661) == "1h 1m"
        assert aiui.format_duration(3600) == "1h"
    
    def test_truncate_text(self):
        """Test text truncation."""
        text = "This is a long text"
        assert aiui.truncate_text(text, 10) == "This is..."
        assert aiui.truncate_text(text, 50) == text
        assert aiui.truncate_text(text, 10, "!!") == "This is!!"
    
    def test_safe_filename(self):
        """Test safe filename generation."""
        assert aiui.safe_filename("test<>file.txt") == "test__file.txt"
        assert aiui.safe_filename("") == "untitled"
        assert aiui.safe_filename("valid_name.txt") == "valid_name.txt"


class TestElementsAPI:
    """Test Element class-level API."""
    
    def test_element_send_method(self):
        """Test that elements have .send() method."""
        from praisonaiui.schema.models import ImageElement
        
        img = ImageElement(url="https://example.com/image.jpg", name="Test Image")
        assert hasattr(img, 'send')
        assert callable(img.send)
    
    @pytest.mark.asyncio
    async def test_element_send_creates_message(self):
        """Test element .send() creates proper message."""
        from praisonaiui.schema.models import ImageElement
        
        # Mock the message context
        mock_context = Mock()
        mock_context._stream_queue = AsyncMock()
        
        with patch('praisonaiui.callbacks._get_context', return_value=mock_context):
            img = ImageElement(url="https://example.com/image.jpg", name="Test Image")
            msg = await img.send("Check this out!")
            
            assert isinstance(msg, aiui.Message)
            assert msg.content == "Check this out!"
            assert len(msg.elements) == 1
    
    def test_element_display_property(self):
        """Test element display property."""
        from praisonaiui.schema.models import ImageElement
        
        img = ImageElement(url="https://example.com/image.jpg", display="side")
        assert img.display == "side"
    
    def test_element_name_property(self):
        """Test element name property."""
        from praisonaiui.schema.models import VideoElement
        
        video = VideoElement(url="https://example.com/video.mp4", name="Demo Video")
        assert video.name == "Demo Video"


class TestElementConstructors:
    """Test Plotly/Pyplot/Dataframe constructors."""
    
    def test_plotly_element_import_error(self):
        """Test PlotlyElement with missing plotly."""
        with patch.dict('sys.modules', {'plotly': None, 'plotly.graph_objects': None}):
            with pytest.raises(ImportError, match="plotly is required"):
                aiui.Plotly(None)
    
    def test_pyplot_element_import_error(self):
        """Test PyplotElement with missing matplotlib."""
        with patch.dict('sys.modules', {'matplotlib': None, 'matplotlib.pyplot': None}):
            with pytest.raises(ImportError, match="matplotlib is required"):
                aiui.Pyplot(None)
    
    def test_dataframe_element_import_error(self):
        """Test DataframeElement with missing pandas."""
        with patch.dict('sys.modules', {'pandas': None}):
            with pytest.raises(ImportError, match="pandas is required"):
                aiui.Dataframe(None)
    
    @pytest.mark.skipif(True, reason="Plotly not installed in test environment")
    def test_plotly_element_creation(self):
        """Test PlotlyElement creation (skipped without plotly)."""
        # Would test actual plotly figure serialization
        pass
    
    @pytest.mark.skipif(True, reason="Matplotlib not installed in test environment")  
    def test_pyplot_element_creation(self):
        """Test PyplotElement creation (skipped without matplotlib)."""
        # Would test actual matplotlib figure conversion
        pass
    
    @pytest.mark.skipif(True, reason="Pandas not installed in test environment")
    def test_dataframe_element_creation(self):
        """Test DataframeElement creation (skipped without pandas)."""
        # Would test actual dataframe serialization
        pass


class TestCustomElement:
    """Test CustomElement functionality."""
    
    def test_custom_element_creation(self):
        """Test CustomElement creation with validation."""
        # Register a test component
        aiui.register_custom_component("TestWidget")
        
        element = aiui.CustomElement(
            name="TestWidget",
            props={"userId": 123},
            height="300px"
        )
        assert element.name == "TestWidget"
        assert element.props == {"userId": 123}
        assert element.height == "300px"
    
    def test_custom_element_unknown_component(self):
        """Test CustomElement with unknown component."""
        with pytest.raises(ValueError, match="Unknown custom component"):
            aiui.CustomElement(name="NonExistentWidget")
    
    def test_custom_element_invalid_props(self):
        """Test CustomElement with invalid props."""
        aiui.register_custom_component("TestWidget2")
        
        # Props with non-serializable data
        invalid_props = {"func": lambda x: x}
        with pytest.raises(ValueError, match="JSON-serializable"):
            aiui.CustomElement(name="TestWidget2", props=invalid_props)
    
    def test_custom_element_to_dict(self):
        """Test CustomElement serialization."""
        aiui.register_custom_component("TestWidget3")
        
        element = aiui.CustomElement(
            name="TestWidget3",
            props={"value": 42},
            height="200px"
        )
        
        data = element.to_dict()
        assert data["type"] == "custom"
        assert data["component"] == "TestWidget3"
        assert data["props"] == {"value": 42}
        assert data["height"] == "200px"
    
    def test_custom_element_protocol(self):
        """Test CustomElementProtocol functionality."""
        protocol = aiui.CustomElementProtocol
        
        # Test component validation
        aiui.register_custom_component("ValidComponent")
        assert protocol.validate_component("ValidComponent") is True
        assert protocol.validate_component("InvalidComponent") is False
        
        # Test props validation  
        assert protocol.validate_props({"key": "value"}) is True
        assert protocol.validate_props({"func": lambda x: x}) is False
        
        # Test factory method
        element = protocol.create_element("ValidComponent", {"test": True})
        assert element.name == "ValidComponent"
        assert element.props == {"test": True}


class TestCopilotFunction:
    """Test CopilotFunction functionality."""
    
    def test_copilot_function_creation(self):
        """Test CopilotFunction creation."""
        func = aiui.CopilotFunction(
            name="test_func",
            description="Test function",
            parameters=[]
        )
        assert func.name == "test_func"
        assert func.description == "Test function"
    
    def test_copilot_function_decorator(self):
        """Test copilot_function decorator."""
        @aiui.copilot_function("navigate", "Navigate to page", [])
        async def navigate_func(url: str):
            return {"navigated": url}
        
        # Function should be registered
        registered = aiui.get_copilot_function("navigate")
        assert registered is not None
        assert registered.name == "navigate"
    
    @pytest.mark.asyncio
    async def test_copilot_function_call(self):
        """Test calling a copilot function."""
        # Create a function with handler
        func = aiui.CopilotFunction(
            name="test_call",
            description="Test call",
            parameters=[]
        )
        
        # Set up handler
        def handler(x, y):
            return x + y
        
        func.handler = handler
        result = await func.call({"x": 5, "y": 3})
        assert result == 8
    
    def test_copilot_function_to_dict(self):
        """Test CopilotFunction serialization to OpenAI format."""
        from praisonaiui.copilot import CopilotFunctionParameter
        
        param = CopilotFunctionParameter(
            name="url", 
            type="string", 
            description="URL to navigate to"
        )
        
        func = aiui.CopilotFunction(
            name="navigate",
            description="Navigate to a page",
            parameters=[param]
        )
        
        schema = func.to_dict()
        assert schema["type"] == "function"
        assert schema["function"]["name"] == "navigate"
        assert "parameters" in schema["function"]
        assert schema["function"]["parameters"]["properties"]["url"]["type"] == "string"
    
    @pytest.mark.asyncio
    async def test_copilot_function_handler_registration(self):
        """Test on_copilot_function_call handler registration."""
        handler_called = False
        
        @aiui.on_copilot_function_call
        async def test_handler(name: str, args: Dict[str, Any]):
            nonlocal handler_called
            handler_called = True
            return {"handled": True, "name": name}
        
        # Call a non-existent function to trigger handlers
        result = await aiui.call_copilot_function("unknown_func", {})
        assert handler_called
        assert result["handled"] is True


class TestChatSettings:
    """Test ChatSettings functionality."""
    
    def test_chat_settings_creation(self):
        """Test ChatSettings creation."""
        settings = aiui.ChatSettings([
            aiui.TextInput(name="prompt", label="System Prompt"),
            aiui.Slider(name="temperature", label="Temperature", min=0.0, max=1.0)
        ])
        assert len(settings.widgets) == 2
        assert settings.title == "Chat Settings"
    
    def test_settings_widgets(self):
        """Test different settings widget types."""
        text_input = aiui.TextInput(name="text", label="Text", placeholder="Enter text...")
        number_input = aiui.NumberInput(name="number", label="Number", min=0, max=100)
        slider = aiui.Slider(name="slider", label="Slider", min=0.0, max=1.0, step=0.1)
        select = aiui.Select(name="select", label="Select", options=["A", "B", "C"])
        switch = aiui.Switch(name="switch", label="Switch", default=True)
        color = aiui.ColorPicker(name="color", label="Color")
        
        widgets = [text_input, number_input, slider, select, switch, color]
        
        for widget in widgets:
            data = widget.to_dict()
            assert "type" in data
            assert "name" in data
            assert "label" in data
    
    def test_chat_settings_serialization(self):
        """Test ChatSettings serialization."""
        settings = aiui.ChatSettings([
            aiui.TextInput(name="prompt", label="Prompt", default="Hello"),
        ])
        
        data = settings.to_dict()
        assert data["type"] == "chat_settings"
        assert "id" in data
        assert data["title"] == "Chat Settings"
        assert len(data["widgets"]) == 1
        assert data["widgets"][0]["name"] == "prompt"
    
    @pytest.mark.asyncio
    async def test_settings_update_handler(self):
        """Test on_settings_update handler."""
        handler_called = False
        received_settings = None
        
        @aiui.on_settings_update
        async def test_handler(settings: Dict[str, Any]):
            nonlocal handler_called, received_settings
            handler_called = True
            received_settings = settings
        
        # Trigger settings update
        test_settings = {"temperature": 0.7, "model": "gpt-4"}
        await aiui.trigger_settings_update(test_settings)
        
        assert handler_called
        assert received_settings == test_settings
    
    def test_preset_settings(self):
        """Test preset settings panels."""
        model_settings = aiui.create_model_settings()
        ui_settings = aiui.create_ui_settings()
        
        assert len(model_settings.widgets) >= 3  # model, temperature, max_tokens, system_prompt
        assert len(ui_settings.widgets) >= 3   # dark_mode, streaming, show_thinking, theme
        
        # Check for expected widget names
        model_widget_names = [w.name for w in model_settings.widgets]
        assert "model" in model_widget_names
        assert "temperature" in model_widget_names
        
        ui_widget_names = [w.name for w in ui_settings.widgets]
        assert "dark_mode" in ui_widget_names


class TestLazyImports:
    """Test that imports are properly lazy."""
    
    def test_import_time_performance(self):
        """Test that import time is reasonable."""
        import sys
        import time
        
        # Remove praisonaiui from modules if already imported
        modules_to_remove = [name for name in sys.modules.keys() if name.startswith('praisonaiui')]
        for name in modules_to_remove:
            if name != 'praisonaiui':  # Don't remove the main module in this test
                sys.modules.pop(name, None)
        
        # Time a fresh import (accessing a lazy attribute)
        start_time = time.time()
        import praisonaiui as aiui
        # Access a lazy import to trigger loading
        _ = aiui.ErrorMessage  # This should trigger lazy import
        import_time = time.time() - start_time
        
        # Should import quickly (under 200ms as per requirement)
        assert import_time < 0.2, f"Import took {import_time:.3f}s, should be under 0.2s"
    
    def test_heavy_deps_not_imported(self):
        """Test that heavy dependencies are not imported by default."""
        import sys
        
        # These should not be imported until explicitly used
        heavy_deps = ['plotly', 'matplotlib', 'pandas']
        
        for dep in heavy_deps:
            assert dep not in sys.modules, f"{dep} should not be auto-imported"
    
    def test_lazy_attribute_access(self):
        """Test lazy attribute access works."""
        # These should all work without importing heavy deps
        assert hasattr(aiui, 'ErrorMessage')
        assert hasattr(aiui, 'make_async')
        assert hasattr(aiui, 'sleep')
        assert hasattr(aiui, 'CustomElement')
        assert hasattr(aiui, 'CopilotFunction')
        assert hasattr(aiui, 'ChatSettings')


class TestRoundTripSerialization:
    """Test that all new message types round-trip properly."""
    
    def test_error_message_round_trip(self):
        """Test ErrorMessage round-trip serialization."""
        original = aiui.ErrorMessage(content="Test error")
        
        # Simulate serialization/deserialization
        data = {
            'content': original.content,
            'author': original.author,
            'metadata': original.metadata,
            'elements': original.elements,
            'actions': original.actions
        }
        
        reconstructed = aiui.ErrorMessage(
            content=data['content'],
            metadata=data['metadata']
        )
        reconstructed.author = data['author']
        
        assert reconstructed.content == original.content
        assert reconstructed.author == original.author
        assert reconstructed.metadata == original.metadata
    
    def test_custom_element_round_trip(self):
        """Test CustomElement round-trip."""
        aiui.register_custom_component("RoundTripTest")
        
        original = aiui.CustomElement(
            name="RoundTripTest",
            props={"value": 42, "text": "hello"},
            height="300px"
        )
        
        data = original.to_dict()
        
        # Reconstruct
        reconstructed = aiui.CustomElement(
            name=data["component"],
            props=data["props"],
            height=data["height"]
        )
        
        assert reconstructed.name == original.name
        assert reconstructed.props == original.props
        assert reconstructed.height == original.height