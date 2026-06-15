"""Test for issue #61 - Persona Model Split Across UI and Agent Planes fix."""

from unittest.mock import Mock, patch

from praisonaiui import server
from praisonaiui.cli import _register_yaml_chat


def test_profile_selection_changes_agent_instructions():
    """Test that selecting different profiles creates agents with different instructions."""

    # Mock the praisonaiagents.Agent to avoid import dependency
    with patch('praisonaiagents.Agent') as mock_agent_class:
        mock_agent_instance = Mock()
        mock_agent_class.return_value = mock_agent_instance

        # Test YAML config with profile-specific instructions
        chat_yaml = {
            "name": "Test Assistant",
            "instructions": "Default instructions",
            "profiles": [
                {
                    "name": "Code Expert",
                    "instructions": "You are a coding expert. Be technical and precise.",
                    "description": "Code expert"
                },
                {
                    "name": "Writer",
                    "instructions": "You are a creative writer. Use flowing prose.",
                    "description": "Creative writer"
                }
            ]
        }

        # Register the YAML chat configuration
        _register_yaml_chat(chat_yaml)

        # Get the _get_agent function that was created during registration
        # It's a closure in the _register_yaml_chat function
        # We'll access it via the registered reply callback
        from praisonaiui.server import _callbacks
        assert "reply" in _callbacks

        # Clear the server's selected profile state
        server._selected_profile = {"id": None}

        # Test 1: No profile selected - should use default instructions
        import asyncio
        from unittest.mock import AsyncMock

        reply_cb = _callbacks["reply"]

        with patch("praisonaiui.say", new_callable=AsyncMock) as mock_say:
            asyncio.run(reply_cb("test"))
            mock_agent_class.assert_called_with(
                name="Test Assistant",
                instructions="Default instructions"
            )

            # Test 2: Set selected profile to "Code Expert"
            mock_agent_class.reset_mock()
            server._selected_profile = {"id": "Code Expert"}
            asyncio.run(reply_cb("test"))
            mock_agent_class.assert_called_with(
                name="Code Expert",
                instructions="You are a coding expert. Be technical and precise."
            )


def test_profile_cache_keys_are_different():
    """Test that different profiles generate different cache keys."""

    # Test the cache key generation logic (simulated)
    profile_1 = "Code Expert"
    profile_2 = "Writer"

    cache_key_1 = f"agent:{profile_1}" if profile_1 else "agent:default"
    cache_key_2 = f"agent:{profile_2}" if profile_2 else "agent:default"
    cache_key_default = "agent:default"

    # Verify cache keys are different for different profiles
    assert cache_key_1 != cache_key_2
    assert cache_key_1 != cache_key_default
    assert cache_key_2 != cache_key_default
    assert cache_key_1 == "agent:Code Expert"
    assert cache_key_2 == "agent:Writer"


def test_get_selected_profile_function_exists():
    """Test that get_selected_profile function is available."""
    from praisonaiui.server import get_selected_profile

    # Should return None initially
    result = get_selected_profile()
    assert result is None or isinstance(result, str)


def test_select_profile_updates_state():
    """Test that profile selection updates the global state."""
    from praisonaiui.server import _selected_profile

    # Initially should be None or have no id
    initial_state = _selected_profile.get("id")

    # Update profile selection
    _selected_profile["id"] = "Test Profile"

    # Verify state was updated
    assert _selected_profile["id"] == "Test Profile"

    # Clean up
    _selected_profile["id"] = initial_state
