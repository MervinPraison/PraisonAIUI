"""Unit tests for compiler chat/auth/widgets output."""

import json
from pathlib import Path

import pytest

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import (
    AuthConfig,
    ChatConfig,
    ChatFeaturesConfig,
    ChatProfileConfig,
    ChatStarterConfig,
    Config,
    InputWidgetConfig,
    LayoutConfig,
    SiteConfig,
)


class TestCompilerChatOutput:
    """Tests for compiler chat config output."""

    def test_style_in_ui_config(self, tmp_path: Path):
        """Test style field is output to ui-config.json."""
        config = Config(
            site=SiteConfig(title="Test"),
            style="chat",
        )
        compiler = Compiler(config, tmp_path)
        result = compiler.compile(tmp_path)

        assert result.success
        ui_config = json.loads((tmp_path / "ui-config.json").read_text())
        assert ui_config["style"] == "chat"

    def test_layout_in_ui_config(self, tmp_path: Path):
        """Test layout config is output to ui-config.json."""
        config = Config(
            site=SiteConfig(title="Test"),
            layout=LayoutConfig(mode="bottom-right", width="400px", height="600px"),
        )
        compiler = Compiler(config, tmp_path)
        result = compiler.compile(tmp_path)

        assert result.success
        ui_config = json.loads((tmp_path / "ui-config.json").read_text())
        assert ui_config["layout"]["mode"] == "bottom-right"
        assert ui_config["layout"]["width"] == "400px"
        assert ui_config["layout"]["height"] == "600px"

    def test_chat_config_in_ui_config(self, tmp_path: Path):
        """Test chat config is output to ui-config.json."""
        config = Config(
            site=SiteConfig(title="Test"),
            chat=ChatConfig(
                enabled=True,
                name="AI Assistant",
                starters=[
                    ChatStarterConfig(label="Hello", message="Hi there", icon="👋"),
                ],
                profiles=[
                    ChatProfileConfig(
                        name="General",
                        description="General assistant",
                        icon="🤖",
                        default=True,
                    ),
                ],
                features=ChatFeaturesConfig(streaming=True, reasoning=True),
            ),
        )
        compiler = Compiler(config, tmp_path)
        result = compiler.compile(tmp_path)

        assert result.success
        ui_config = json.loads((tmp_path / "ui-config.json").read_text())
        assert ui_config["chat"]["enabled"] is True
        assert ui_config["chat"]["name"] == "AI Assistant"
        assert len(ui_config["chat"]["starters"]) == 1
        assert ui_config["chat"]["starters"][0]["label"] == "Hello"
        assert len(ui_config["chat"]["profiles"]) == 1
        assert ui_config["chat"]["profiles"][0]["name"] == "General"
        assert ui_config["chat"]["features"]["streaming"] is True

    def test_auth_config_in_ui_config(self, tmp_path: Path):
        """Test auth config is output to ui-config.json."""
        config = Config(
            site=SiteConfig(title="Test"),
            auth=AuthConfig(
                enabled=True,
                providers=["password", "google"],
                require_auth=True,
            ),
        )
        compiler = Compiler(config, tmp_path)
        result = compiler.compile(tmp_path)

        assert result.success
        ui_config = json.loads((tmp_path / "ui-config.json").read_text())
        assert ui_config["auth"]["enabled"] is True
        assert "password" in ui_config["auth"]["providers"]
        assert "google" in ui_config["auth"]["providers"]
        assert ui_config["auth"]["requireAuth"] is True

    def test_widgets_in_ui_config(self, tmp_path: Path):
        """Test widgets config is output to ui-config.json."""
        config = Config(
            site=SiteConfig(title="Test"),
            widgets=[
                InputWidgetConfig(
                    type="slider",
                    name="temperature",
                    label="Temperature",
                    default=0.7,
                    min=0,
                    max=2,
                    step=0.1,
                ),
                InputWidgetConfig(
                    type="select",
                    name="model",
                    label="Model",
                    options=["gpt-4o", "claude-3.5"],
                ),
            ],
        )
        compiler = Compiler(config, tmp_path)
        result = compiler.compile(tmp_path)

        assert result.success
        ui_config = json.loads((tmp_path / "ui-config.json").read_text())
        assert len(ui_config["widgets"]) == 2
        assert ui_config["widgets"][0]["type"] == "slider"
        assert ui_config["widgets"][0]["name"] == "temperature"
        assert ui_config["widgets"][0]["default"] == 0.7
        assert ui_config["widgets"][1]["type"] == "select"
        assert ui_config["widgets"][1]["options"] == ["gpt-4o", "claude-3.5"]
