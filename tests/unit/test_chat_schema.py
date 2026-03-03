"""Unit tests for chat-related Pydantic models."""

import pytest
from pydantic import ValidationError

from praisonaiui.schema.models import (
    AuthConfig,
    ChatConfig,
    ChatFeaturesConfig,
    ChatInputConfig,
    ChatProfileConfig,
    ChatStarterConfig,
    Config,
    InputWidgetConfig,
    LayoutConfig,
    SiteConfig,
)


class TestChatProfileConfig:
    """Tests for ChatProfileConfig model."""

    def test_minimal_profile(self):
        """Test creating a profile with just a name."""
        profile = ChatProfileConfig(name="General")
        assert profile.name == "General"
        assert profile.description is None
        assert profile.agent is None
        assert profile.default is False

    def test_full_profile(self):
        """Test creating a profile with all fields."""
        profile = ChatProfileConfig(
            name="Code Helper",
            description="Helps with coding tasks",
            agent="code-agent",
            icon="💻",
            default=True,
        )
        assert profile.name == "Code Helper"
        assert profile.description == "Helps with coding tasks"
        assert profile.agent == "code-agent"
        assert profile.icon == "💻"
        assert profile.default is True


class TestChatStarterConfig:
    """Tests for ChatStarterConfig model."""

    def test_starter_creation(self):
        """Test creating a starter message."""
        starter = ChatStarterConfig(
            label="Hello",
            message="Say hello to me",
            icon="👋",
        )
        assert starter.label == "Hello"
        assert starter.message == "Say hello to me"
        assert starter.icon == "👋"

    def test_starter_without_icon(self):
        """Test creating a starter without icon."""
        starter = ChatStarterConfig(label="Help", message="What can you do?")
        assert starter.label == "Help"
        assert starter.icon is None


class TestChatFeaturesConfig:
    """Tests for ChatFeaturesConfig model."""

    def test_default_features(self):
        """Test default feature values."""
        features = ChatFeaturesConfig()
        assert features.streaming is True
        assert features.file_upload is True
        assert features.audio is False
        assert features.reasoning is True
        assert features.tools is True
        assert features.multimedia is True
        assert features.history is True
        assert features.feedback is False
        assert features.code_execution is False

    def test_custom_features(self):
        """Test custom feature values."""
        features = ChatFeaturesConfig(
            streaming=False,
            audio=True,
            feedback=True,
        )
        assert features.streaming is False
        assert features.audio is True
        assert features.feedback is True


class TestChatConfig:
    """Tests for ChatConfig model."""

    def test_disabled_chat(self):
        """Test default disabled chat."""
        chat = ChatConfig()
        assert chat.enabled is False
        assert chat.starters == []
        assert chat.profiles == []

    def test_enabled_chat_with_starters(self):
        """Test enabled chat with starters."""
        chat = ChatConfig(
            enabled=True,
            name="AI Assistant",
            starters=[
                ChatStarterConfig(label="Hello", message="Hi there"),
            ],
        )
        assert chat.enabled is True
        assert chat.name == "AI Assistant"
        assert len(chat.starters) == 1


class TestLayoutConfig:
    """Tests for LayoutConfig model."""

    def test_default_layout(self):
        """Test default layout values."""
        layout = LayoutConfig()
        assert layout.mode == "fullscreen"
        assert layout.width is None
        assert layout.height is None

    def test_copilot_layout(self):
        """Test copilot widget layout."""
        layout = LayoutConfig(
            mode="bottom-right",
            width="380px",
            height="500px",
        )
        assert layout.mode == "bottom-right"
        assert layout.width == "380px"
        assert layout.height == "500px"

    def test_invalid_mode(self):
        """Test invalid layout mode."""
        with pytest.raises(ValidationError):
            LayoutConfig(mode="invalid")


class TestAuthConfig:
    """Tests for AuthConfig model."""

    def test_default_auth(self):
        """Test default auth values."""
        auth = AuthConfig()
        assert auth.enabled is False
        assert auth.providers == ["password"]
        assert auth.require_auth is False

    def test_oauth_auth(self):
        """Test OAuth auth configuration."""
        auth = AuthConfig(
            enabled=True,
            providers=["password", "google", "github"],
            require_auth=True,
        )
        assert auth.enabled is True
        assert "google" in auth.providers
        assert auth.require_auth is True


class TestInputWidgetConfig:
    """Tests for InputWidgetConfig model."""

    def test_slider_widget(self):
        """Test slider widget configuration."""
        widget = InputWidgetConfig(
            type="slider",
            name="temperature",
            label="Temperature",
            default=0.7,
            min=0,
            max=2,
            step=0.1,
        )
        assert widget.type == "slider"
        assert widget.name == "temperature"
        assert widget.default == 0.7

    def test_select_widget(self):
        """Test select widget configuration."""
        widget = InputWidgetConfig(
            type="select",
            name="model",
            options=["gpt-4o", "claude-3.5"],
        )
        assert widget.type == "select"
        assert len(widget.options) == 2


class TestConfigWithChat:
    """Tests for Config model with chat features."""

    def test_config_with_chat_style(self):
        """Test config with chat style."""
        config = Config(
            site=SiteConfig(title="My App"),
            style="chat",
            chat=ChatConfig(enabled=True),
        )
        assert config.style == "chat"
        assert config.chat.enabled is True

    def test_config_with_layout(self):
        """Test config with layout."""
        config = Config(
            site=SiteConfig(title="My App"),
            layout=LayoutConfig(mode="sidebar"),
        )
        assert config.layout.mode == "sidebar"

    def test_config_with_widgets(self):
        """Test config with widgets."""
        config = Config(
            site=SiteConfig(title="My App"),
            widgets=[
                InputWidgetConfig(type="slider", name="temp"),
            ],
        )
        assert len(config.widgets) == 1

    def test_default_style_is_docs(self):
        """Test default style is docs."""
        config = Config(site=SiteConfig(title="Test"))
        assert config.style == "docs"
