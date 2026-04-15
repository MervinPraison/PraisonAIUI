"""Test that preset names are in sync across all three locations.

Single source of truth: themes.PRESET_NAMES
Must match: schema/models.py ThemeConfig Literal, features/theme.py PRESET_COLORS keys,
and themes.py FALLBACK_THEMES keys.
"""

from praisonaiui.features.theme import PRESET_COLORS
from praisonaiui.schema.models import ThemeConfig
from praisonaiui.themes import FALLBACK_THEMES, PRESET_NAMES


class TestPresetSync:
    """All three preset lists must be identical."""

    def test_fallback_themes_match_preset_names(self):
        assert set(FALLBACK_THEMES.keys()) == set(PRESET_NAMES)

    def test_preset_colors_match_preset_names(self):
        assert set(PRESET_COLORS.keys()) == set(PRESET_NAMES)

    def test_schema_literal_matches_preset_names(self):
        """ThemeConfig.preset field must accept all PRESET_NAMES."""
        for name in PRESET_NAMES:
            cfg = ThemeConfig(preset=name)
            assert cfg.preset == name

    def test_count_is_22(self):
        assert len(PRESET_NAMES) == 22
