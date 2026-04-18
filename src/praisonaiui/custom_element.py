"""Custom element support for PraisonAIUI.

This module provides CustomElement for mounting arbitrary user-authored
UI components inside chat bubbles via iframe/React slots.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Set

# Registry of valid custom element components
_registered_components: Set[str] = set()


def register_custom_component(name: str) -> None:
    """Register a custom component as valid for use.

    Args:
        name: Component name (should match a React component in frontend/src/components/custom/)
    """
    _registered_components.add(name)


def get_registered_components() -> Set[str]:
    """Get the set of registered custom components.

    Returns:
        Set of registered component names
    """
    return _registered_components.copy()


@dataclass
class CustomElement:
    """Custom React component element for messages.

    Renders a named React component registered in frontend/src/components/custom/
    with provided props. The component is mounted inside a chat bubble.

    Example:
        # Register component first
        register_custom_component("UserProfile")

        # Create element with props
        custom = CustomElement(
            name="UserProfile",
            props={"userId": 123, "showAvatar": True},
            height="200px"
        )
        await custom.send()
    """

    name: str
    props: Dict[str, Any] = field(default_factory=dict)
    height: Optional[str] = None
    display: str = "inline"  # For compatibility with MessageElement interface

    def __post_init__(self):
        """Validate component name against registry."""
        if self.name not in _registered_components:
            raise ValueError(
                f"Unknown custom component '{self.name}'. "
                f"Available components: {sorted(_registered_components)} "
                f"Register with register_custom_component() first."
            )

        # Validate props are JSON-serializable
        try:
            import json
            json.dumps(self.props)
        except (TypeError, ValueError) as e:
            raise ValueError(f"Custom element props must be JSON-serializable: {e}")

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "type": "custom",
            "component": self.name,
            "props": self.props,
            "height": self.height,
            "display": self.display
        }

    async def send(self, content: str = "") -> "Message":
        """Send this custom element as a standalone message.

        Args:
            content: Optional message content to accompany the element

        Returns:
            The Message object that was sent
        """
        # Import here to avoid circular imports
        from praisonaiui.message import Message

        # Create a message containing this element
        msg = Message(content=content, elements=[self.to_dict()])
        await msg.send()
        return msg


# Pre-register some common example components
def _register_defaults():
    """Register default example components."""
    default_components = [
        "ExampleWidget",
        "UserCard",
        "DataChart",
        "FormBuilder",
        "CodeEditor",
        "ImageGallery",
        "ChatEmbed"
    ]

    for component in default_components:
        register_custom_component(component)


# Register defaults on module import
_register_defaults()


class CustomElementProtocol:
    """Protocol for custom element validation and rendering."""

    @classmethod
    def validate_component(cls, name: str) -> bool:
        """Validate that a component name is registered.

        Args:
            name: Component name to validate

        Returns:
            True if component is registered, False otherwise
        """
        return name in _registered_components

    @classmethod
    def validate_props(cls, props: Dict[str, Any]) -> bool:
        """Validate that props are serializable.

        Args:
            props: Props dictionary to validate

        Returns:
            True if props are valid, False otherwise
        """
        try:
            import json
            json.dumps(props)
            return True
        except (TypeError, ValueError):
            return False

    @classmethod
    def create_element(cls, name: str, props: Optional[Dict[str, Any]] = None,
                      height: Optional[str] = None, **kwargs) -> CustomElement:
        """Factory method to create a CustomElement with validation.

        Args:
            name: Component name
            props: Component props
            height: Optional height constraint
            **kwargs: Additional element properties

        Returns:
            CustomElement instance

        Raises:
            ValueError: If component name is not registered or props are invalid
        """
        if props is None:
            props = {}

        if not cls.validate_component(name):
            raise ValueError(f"Component '{name}' is not registered")

        if not cls.validate_props(props):
            raise ValueError("Props must be JSON-serializable")

        return CustomElement(
            name=name,
            props=props,
            height=height,
            **kwargs
        )
