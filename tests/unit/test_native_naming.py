"""Tests for PraisonAIUI-native public API names (non-developer-friendly).

These names are shorter, plain-English aliases for symbols we inherited
from the broader agent-UI ecosystem. The aliases resolve to *the exact
same objects* so both names behave identically at runtime. Users should
prefer the native names in new code; the originals remain supported.
"""

from __future__ import annotations

import pytest

import praisonaiui as aiui

# ── Ask* message family ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "new_name, old_name",
    [
        ("TextPrompt", "AskUserMessage"),
        ("FilePrompt", "AskFileMessage"),
        ("ChoicePrompt", "AskActionMessage"),
        ("LocationPrompt", "AskElementMessage"),
    ],
)
def test_prompt_family_native_aliases(new_name: str, old_name: str) -> None:
    assert getattr(aiui, new_name) is getattr(aiui, old_name)


# ── UI / browser-callable functions ─────────────────────────────────


@pytest.mark.parametrize(
    "new_name, old_name",
    [
        ("UIFunction", "CopilotFunction"),
        ("UIFunctionParameter", "CopilotFunctionParameter"),
        ("ui_function", "copilot_function"),
        ("on_ui_function", "on_copilot_function_call"),
        ("call_ui_function", "call_copilot_function"),
        ("get_ui_function", "get_copilot_function"),
        ("get_ui_functions", "get_copilot_functions"),
    ],
)
def test_ui_function_native_aliases(new_name: str, old_name: str) -> None:
    # UIFunctionParameter isn't re-exported at aiui top-level; check module
    if new_name == "UIFunctionParameter":
        from praisonaiui import copilot

        assert getattr(copilot, new_name) is getattr(copilot, old_name)
        return
    assert getattr(aiui, new_name) is getattr(aiui, old_name)


# ── Settings ────────────────────────────────────────────────────────


def test_settings_alias() -> None:
    assert aiui.Settings is aiui.ChatSettings


def test_on_settings_change_is_callable_decorator() -> None:
    @aiui.on_settings_change
    def handler(payload: dict) -> None:
        pass

    # Should register under the same underlying callback registry as the
    # legacy name
    from praisonaiui.chat_settings import get_settings_handlers

    assert handler in get_settings_handlers()


# ── Auth callbacks ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "new_name, old_name",
    [
        ("on_oauth_login", "oauth_callback"),
        ("on_header_login", "header_auth_callback"),
        ("on_password_login", "password_auth_callback"),
        ("on_shared_view", "on_shared_thread_view"),
    ],
)
def test_auth_native_aliases(new_name: str, old_name: str) -> None:
    assert getattr(aiui, new_name) is getattr(aiui, old_name)


# ── Lifecycle / window / audio / slack ──────────────────────────────


@pytest.mark.parametrize(
    "new_name, old_name",
    [
        ("on_startup", "on_app_startup"),
        ("on_shutdown", "on_app_shutdown"),
        ("on_parent_message", "on_window_message"),
        ("send_to_parent", "send_window_message"),
        ("on_mic_start", "on_audio_start"),
        ("on_mic_data", "on_audio_chunk"),
        ("on_mic_stop", "on_audio_end"),
        ("on_slack_reaction", "on_slack_reaction_added"),
    ],
)
def test_event_hook_native_aliases(new_name: str, old_name: str) -> None:
    assert getattr(aiui, new_name) is getattr(aiui, old_name)


# ── Public surface advertises the native names ──────────────────────


def test_native_names_in_dunder_all() -> None:
    expected = {
        "TextPrompt",
        "FilePrompt",
        "ChoicePrompt",
        "LocationPrompt",
        "UIFunction",
        "ui_function",
        "on_ui_function",
        "call_ui_function",
        "get_ui_function",
        "get_ui_functions",
        "Settings",
        "on_settings_change",
        "on_oauth_login",
        "on_header_login",
        "on_password_login",
        "on_shared_view",
        "on_slack_reaction",
        "on_startup",
        "on_shutdown",
        "on_parent_message",
        "send_to_parent",
        "on_mic_start",
        "on_mic_data",
        "on_mic_stop",
    }
    missing = expected - set(aiui.__all__)
    assert not missing, f"Missing from __all__: {sorted(missing)}"
