"""Chat settings runtime edit panel for PraisonAIUI.

This module provides ChatSettings for rendering a side form panel that allows
users to edit model/temperature/system prompt at runtime, with changes firing
@on_settings_update hooks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union, Awaitable
import uuid


# Settings update handlers
_settings_handlers: List[Callable[[Dict[str, Any]], Awaitable[None]]] = []


@dataclass
class SettingsWidget:
    """Base class for settings form widgets."""
    
    type: str
    name: str
    label: Optional[str] = None
    default: Any = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "type": self.type,
            "name": self.name,
            "label": self.label or self.name,
            "default": self.default
        }


@dataclass
class TextInput(SettingsWidget):
    """Text input widget for settings."""
    
    type: str = field(default="text", init=False)
    placeholder: Optional[str] = None
    multiline: bool = False
    max_length: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = super().to_dict()
        result.update({
            "placeholder": self.placeholder,
            "multiline": self.multiline,
            "maxLength": self.max_length
        })
        return result


@dataclass
class NumberInput(SettingsWidget):
    """Number input widget for settings."""
    
    type: str = field(default="number", init=False)
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = super().to_dict()
        result.update({
            "min": self.min,
            "max": self.max,
            "step": self.step
        })
        return result


@dataclass
class Slider(SettingsWidget):
    """Slider widget for settings."""
    
    type: str = field(default="slider", init=False)
    min: float = 0.0
    max: float = 1.0
    step: float = 0.1
    
    def to_dict(self) -> Dict[str, Any]:
        result = super().to_dict()
        result.update({
            "min": self.min,
            "max": self.max,  
            "step": self.step
        })
        return result


@dataclass
class Select(SettingsWidget):
    """Select dropdown widget for settings."""
    
    type: str = field(default="select", init=False)
    options: List[Union[str, Dict[str, str]]] = field(default_factory=list)
    multiple: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        result = super().to_dict()
        result.update({
            "options": self.options,
            "multiple": self.multiple
        })
        return result


@dataclass
class Switch(SettingsWidget):
    """Switch/toggle widget for settings."""
    
    type: str = field(default="switch", init=False)
    
    def to_dict(self) -> Dict[str, Any]:
        return super().to_dict()


@dataclass
class ColorPicker(SettingsWidget):
    """Color picker widget for settings."""
    
    type: str = field(default="color", init=False)
    
    def to_dict(self) -> Dict[str, Any]:
        return super().to_dict()


@dataclass
class ChatSettings:
    """Chat settings panel configuration.
    
    Renders a side form with the provided widgets and fires @on_settings_update
    when changes are made.
    
    Example:
        settings = ChatSettings([
            Select(
                name="model",
                label="Model",
                options=["gpt-4", "gpt-3.5-turbo", "claude-3"],
                default="gpt-4"
            ),
            Slider(
                name="temperature", 
                label="Temperature",
                min=0.0,
                max=2.0,
                step=0.1,
                default=0.7
            ),
            TextInput(
                name="system_prompt",
                label="System Prompt", 
                multiline=True,
                default="You are a helpful assistant."
            )
        ])
        
        await settings.send()
    """
    
    widgets: List[SettingsWidget]
    title: str = "Chat Settings"
    description: Optional[str] = None
    
    _id: str = field(default_factory=lambda: str(uuid.uuid4()))
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "type": "chat_settings",
            "id": self._id,
            "title": self.title,
            "description": self.description,
            "widgets": [widget.to_dict() for widget in self.widgets]
        }
    
    async def send(self) -> "ChatSettings":
        """Send the settings panel to the client.
        
        Returns:
            self for chaining
        """
        # Get current context to send via stream
        from praisonaiui.callbacks import _get_context
        
        context = _get_context()
        if not context or not context._stream_queue:
            return self
        
        # Send settings panel event
        await context._stream_queue.put({
            "type": "chat_settings_panel",
            "data": self.to_dict()
        })
        
        return self


def on_settings_update(handler: Callable[[Dict[str, Any]], Awaitable[None]]):
    """Register a handler for settings updates.
    
    The handler receives a dictionary of the updated settings values.
    
    Args:
        handler: Async function that handles settings updates
        
    Example:
        @on_settings_update
        async def handle_settings_change(settings: dict):
            model = settings.get("model")
            temperature = settings.get("temperature") 
            system_prompt = settings.get("system_prompt")
            
            # Update your agent configuration
            await update_agent_config(
                model=model,
                temperature=temperature, 
                system_prompt=system_prompt
            )
    """
    _settings_handlers.append(handler)
    return handler


async def trigger_settings_update(settings: Dict[str, Any]) -> None:
    """Trigger all registered settings update handlers.
    
    Args:
        settings: Updated settings dictionary
    """
    for handler in _settings_handlers:
        try:
            await handler(settings)
        except Exception as e:
            # Log error but don't break other handlers
            print(f"Error in settings update handler: {e}")


def get_settings_handlers() -> List[Callable]:
    """Get all registered settings update handlers.
    
    Returns:
        List of registered handlers
    """
    return _settings_handlers.copy()


# Common settings presets
def create_model_settings() -> ChatSettings:
    """Create common model configuration settings panel."""
    return ChatSettings([
        Select(
            name="model",
            label="Model",
            options=[
                {"value": "gpt-4", "label": "GPT-4"},
                {"value": "gpt-3.5-turbo", "label": "GPT-3.5 Turbo"}, 
                {"value": "claude-3", "label": "Claude 3"},
                {"value": "claude-3-haiku", "label": "Claude 3 Haiku"},
            ],
            default="gpt-4"
        ),
        Slider(
            name="temperature",
            label="Temperature",
            min=0.0,
            max=2.0,
            step=0.1,
            default=0.7
        ),
        Slider(
            name="max_tokens",
            label="Max Tokens", 
            min=100,
            max=4000,
            step=100,
            default=2000
        ),
        TextInput(
            name="system_prompt",
            label="System Prompt",
            multiline=True,
            placeholder="Enter system prompt...",
            default="You are a helpful assistant."
        )
    ], title="Model Settings", description="Configure the AI model parameters")


def create_ui_settings() -> ChatSettings:
    """Create common UI configuration settings panel.""" 
    return ChatSettings([
        Switch(
            name="dark_mode",
            label="Dark Mode",
            default=True
        ),
        Switch(
            name="streaming",
            label="Streaming Responses",
            default=True
        ),
        Switch(
            name="show_thinking",
            label="Show Thinking Steps", 
            default=True
        ),
        Select(
            name="theme",
            label="Theme",
            options=[
                {"value": "zinc", "label": "Zinc"},
                {"value": "blue", "label": "Blue"},
                {"value": "green", "label": "Green"},
                {"value": "purple", "label": "Purple"}
            ],
            default="zinc"
        )
    ], title="UI Settings", description="Configure the user interface")