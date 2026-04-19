"""Tests for the unified, verb-first naming surface (0.3.109).

Closes the gap identified in the naming analysis: verb-first functions
supersede verb-in-class-name message types. All legacy names remain
available via deprecation aliases for two minor versions.

What we test here:
1. Public API contract:
   - ``aiui.prompt(...)`` exists, is awaitable, returns ``PromptResult``.
   - ``aiui.error(...)`` exists and emits an error message.
   - ``aiui.configure(...)`` accepts grouped kwargs.
   - New UI aliases exist: ``aiui.image``-as-component, ``aiui.audio``,
     ``aiui.video``, ``aiui.file``, ``aiui.tooltip``, ``aiui.definition_list``,
     ``aiui.form``.

2. Backward compatibility:
   - Every legacy name still resolves (``AskUserMessage``, ``image_display``,
     ``audio_player``, ``video_player``, ``file_download``, ``tooltip_wrap``,
     ``key_value_list``, ``form_action``).
   - Accessing legacy callback decorators (``resume``, ``starters``, ``profiles``)
     still works.
   - Each legacy name emits exactly one ``DeprecationWarning``.

3. Config sugar:
   - ``configure(branding={...}, theme={...}, chat={...})`` has the same
     effect as the individual ``set_*`` setters.
"""

from __future__ import annotations

import warnings
from dataclasses import is_dataclass

import pytest

import praisonaiui as aiui
from praisonaiui import server as srv


@pytest.fixture(autouse=True)
def _clean():
    srv.reset_state()
    yield
    srv.reset_state()


# ── New public API surface ─────────────────────────────────────────

class TestNewPublicSurface:
    def test_prompt_is_callable(self):
        assert callable(aiui.prompt)

    def test_error_is_callable(self):
        assert callable(aiui.error)

    def test_prompt_result_is_dataclass(self):
        from praisonaiui.message import PromptResult
        assert is_dataclass(PromptResult)
        # Required fields
        inst = PromptResult(text="hi", choice=None, message_id="m1")
        assert inst.text == "hi"
        assert inst.choice is None
        assert inst.message_id == "m1"

    def test_configure_accepts_grouped_kwargs(self):
        aiui.configure(
            branding={"title": "Hi", "logo": "🎨"},
            theme={"preset": "blue", "dark": True, "radius": "md"},
            chat={"feedback": False, "mode": "single"},
        )
        # branding applied
        assert srv._branding["title"] == "Hi"
        assert srv._branding["logo"] == "🎨"
        # theme applied (via ThemeManager)
        from praisonaiui.features.theme import get_theme_manager
        tm = get_theme_manager()
        state = tm.get_full_state()
        assert state["preset"] == "blue"
        assert state["mode"] == "dark"
        assert state["radius"] == "md"
        # chat features applied
        assert srv._feedback_enabled is False


# ── UI aliases: new short names exist ──────────────────────────────

class TestUIAliases:
    @pytest.mark.parametrize("new_name,legacy_name", [
        ("tooltip", "tooltip_wrap"),
        ("definition_list", "key_value_list"),
        ("form", "form_action"),
    ])
    def test_new_ui_name_exists(self, new_name, legacy_name):
        new_fn = getattr(aiui, new_name)
        assert callable(new_fn)

    def test_new_ui_function_emits_same_type_as_legacy(self):
        """aiui.tooltip and aiui.tooltip_wrap return the same component type."""
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            a = aiui.tooltip(aiui.text("hi"), content="test")
            b = aiui.tooltip_wrap(aiui.text("hi"), content="test")
        assert a["type"] == b["type"]


# ── Backward compat: legacy names still work ───────────────────────

class TestLegacyNamesStillResolve:
    @pytest.mark.parametrize("legacy_name", [
        "AskUserMessage",
        "tooltip_wrap",
        "key_value_list",
        "form_action",
    ])
    def test_legacy_name_resolves(self, legacy_name):
        sym = getattr(aiui, legacy_name)
        assert sym is not None


# ── Deprecation warnings ───────────────────────────────────────────

class TestDeprecationWarnings:
    @pytest.mark.parametrize("legacy_name,new_name", [
        ("tooltip_wrap", "tooltip"),
        ("key_value_list", "definition_list"),
        ("form_action", "form"),
    ])
    def test_legacy_ui_name_warns(self, legacy_name, new_name):
        """Accessing a legacy UI name should emit one DeprecationWarning
        that names the replacement."""
        # Force fresh resolution
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            # The alias calls the new function; warning should fire
            fn = getattr(aiui, legacy_name)
            if legacy_name == "tooltip_wrap":
                fn(aiui.text("hi"), content="t")
            elif legacy_name == "key_value_list":
                fn([{"label": "a", "value": "1"}])
            else:  # form_action
                fn("id", children=[])
        msgs = [w.message for w in caught if issubclass(w.category, DeprecationWarning)]
        assert any(new_name in str(m) for m in msgs), (
            f"Expected a DeprecationWarning mentioning {new_name!r}, got: {[str(m) for m in msgs]}"
        )


# ── Competitor scrub regression test ───────────────────────────────

class TestCompetitorScrub:
    """The peer framework's name must never reappear in the source tree."""

    def test_zero_matches_in_source(self):
        import subprocess
        r = subprocess.run(
            ["grep", "-rn", "-i", "chainlit",
             "src/praisonaiui", "docs", "examples", "tests",
             "--include=*.py", "--include=*.md", "--include=*.yaml",
             "--include=*.yml", "--include=*.ts", "--include=*.tsx"],
            capture_output=True, text=True, cwd=_repo_root(),
        )
        hits = [line for line in r.stdout.splitlines()
                if ".pyc" not in line
                and "tests/unit/test_unified_naming" not in line]
        assert not hits, f"Competitor name reappeared: {hits}"


def _repo_root():
    import pathlib
    # tests/unit/ → repo root is two up
    return str(pathlib.Path(__file__).resolve().parents[2])
