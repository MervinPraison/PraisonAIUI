"""Seed theme contract (ADR-0001 §7): themes.get_seed_theme_css and its mirrors.

Python emits seeds only; styles/theme.css derives every shadcn variable. The
same preset tables live in src/frontend/src/themes.ts, so they are compared
here too.
"""

import re
import warnings
from pathlib import Path

import pytest

from praisonaiui.features.theme import PRESET_COLORS
from praisonaiui.schema.models import Config, SiteConfig
from praisonaiui.schema.validators import find_legacy_hsl_vars, validate_config
from praisonaiui.themes import (
    NEUTRAL_TINTS,
    PRESET_ACCENT_LIGHT,
    PRESET_NAMES,
    get_seed_theme_css,
    inject_theme_css,
    preset_accents,
)

THEMES_TS = Path("src/frontend/src/themes.ts")
THEME_CSS = Path("src/frontend/src/styles/theme.css")


def _decls(css: str) -> dict[str, str]:
    root = re.search(r":root \{([^}]*)\}", css)
    assert root, css
    return dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", root.group(1)))


class TestPresets:
    @pytest.mark.parametrize("preset", sorted(NEUTRAL_TINTS))
    def test_neutral_presets_are_monochrome(self, preset):
        d = _decls(get_seed_theme_css(preset))
        assert d["--seed-tint"] == NEUTRAL_TINTS[preset]
        assert d["--seed-accent"] == "var(--seed-ink)"
        assert d["--accent-mix"] == "0%"
        assert "--seed-accent-light" not in d
        assert d["--db-accent-rgb"] == PRESET_COLORS[preset]["accentRgb"]

    @pytest.mark.parametrize("preset", sorted(PRESET_ACCENT_LIGHT))
    def test_colour_presets_seed_light_600_and_dark_500(self, preset):
        d = _decls(get_seed_theme_css(preset))
        assert d["--seed-accent-light"] == PRESET_ACCENT_LIGHT[preset]
        assert d["--seed-accent-dark"] == PRESET_COLORS[preset]["accent"]
        assert d["--accent-mix"] == "4%"
        assert d["--seed-tint"] == NEUTRAL_TINTS["zinc"]
        assert "--seed-accent" not in d  # theme.css picks light/dark per mode
        assert d["--db-accent-rgb"] == PRESET_COLORS[preset]["accentRgb"]

    def test_every_preset_is_covered(self):
        assert set(NEUTRAL_TINTS) | set(PRESET_ACCENT_LIGHT) == set(PRESET_NAMES)
        assert not set(NEUTRAL_TINTS) & set(PRESET_ACCENT_LIGHT)

    def test_default_and_unknown_preset_mean_zinc(self):
        assert get_seed_theme_css() == get_seed_theme_css("zinc")
        assert get_seed_theme_css("ocean") == get_seed_theme_css("zinc")
        assert get_seed_theme_css("BLUE") == get_seed_theme_css("blue")

    def test_never_emits_shadcn_vars_or_hsl_triples(self):
        for preset in PRESET_NAMES:
            css = get_seed_theme_css(preset, "lg", None, "compact")
            assert "--background" not in css
            assert "--primary" not in css
            assert ".dark" not in css
            assert not re.search(r":\s*[\d.]+\s+[\d.]+%\s+[\d.]+%", css)


class TestAccentOverride:
    def test_accent_override_pins_accent_and_sets_db_accent_rgb(self):
        d = _decls(get_seed_theme_css("zinc", accent="#0077b6"))
        assert d["--seed-accent"] == "#0077b6"
        assert d["--accent-mix"] == "4%"
        assert d["--db-accent-rgb"] == "0,119,182"
        assert "--seed-accent-light" not in d

    def test_short_hex_accent(self):
        assert _decls(get_seed_theme_css("zinc", accent="#38f"))["--db-accent-rgb"] == "51,136,255"

    def test_functional_accent_keeps_preset_rgb(self):
        d = _decls(get_seed_theme_css("blue", accent="oklch(0.6 0.2 250)"))
        assert d["--seed-accent"] == "oklch(0.6 0.2 250)"
        assert d["--db-accent-rgb"] == PRESET_COLORS["blue"]["accentRgb"]

    def test_preset_own_accent_is_not_an_override(self):
        """A server passing the preset's 500 accent keeps the light 600 shade."""
        assert get_seed_theme_css("blue", accent="#3B82F6") == get_seed_theme_css("blue")

    @pytest.mark.parametrize("preset", sorted(PRESET_NAMES))
    def test_theme_manager_accent_round_trips_to_the_preset(self, preset):
        """ThemeManager reports PRESET_COLORS[p].accent for every preset (zinc
        included); forwarding it must not pin a grey accent on a neutral preset."""
        accent = PRESET_COLORS[preset]["accent"]
        assert get_seed_theme_css(preset, accent=accent) == get_seed_theme_css(preset)

    @pytest.mark.parametrize("bad", ["red;}body{color:red", "url(x)", "</style><script>", "#12"])
    def test_invalid_accent_is_ignored(self, bad, caplog):
        css = get_seed_theme_css("blue", accent=bad)
        assert css == get_seed_theme_css("blue")
        assert "invalid theme accent" in caplog.text


class TestRadiusAndDensity:
    @pytest.mark.parametrize(
        "radius,expected",
        [("none", "0"), ("sm", "0.3rem"), ("md", "0.5rem"), ("lg", "0.75rem"), ("xl", "1rem"),
         ("0.625rem", "0.625rem"), ("6px", "6px"), ("0", "0")],
    )
    def test_radius_presets_and_lengths(self, radius, expected):
        assert _decls(get_seed_theme_css("zinc", radius))["--radius"] == expected

    @pytest.mark.parametrize("bad", ["1rem;}", "calc(1px)", "big"])
    def test_invalid_radius_is_skipped(self, bad):
        assert "--radius" not in get_seed_theme_css("zinc", bad)

    def test_no_radius_means_theme_css_default(self):
        assert "--radius" not in get_seed_theme_css("zinc")

    def test_density_emits_html_not_data_density(self):
        css = get_seed_theme_css("zinc", density="compact")
        assert "html:not([data-density]) { --density: 0.875; --font-size-base: 0.875rem; }" in css
        css = get_seed_theme_css("zinc", density="spacious")
        assert "html:not([data-density]) { --density: 1.125; --font-size-base: 1rem; }" in css

    def test_no_or_invalid_density_emits_nothing(self):
        assert "data-density" not in get_seed_theme_css("zinc")
        assert "data-density" not in get_seed_theme_css("zinc", density="huge")


class TestInjectThemeCss:
    def test_build_time_theme_css_is_seeds(self, tmp_path: Path):
        inject_theme_css(tmp_path, preset="rose", dark_mode=True, radius="1rem")
        css = (tmp_path / "assets" / "theme.css").read_text(encoding="utf-8")
        assert css == get_seed_theme_css("rose", "1rem")


class TestFrontendMirrors:
    """themes.ts and theme.css must agree with the Python tables."""

    def _ts_table(self, name: str) -> str:
        src = THEMES_TS.read_text(encoding="utf-8")
        start = src.index(f"export const {name}")
        return src[start : src.index("\n}\n", start)]

    def test_themes_ts_preset_accents_match_python(self):
        body = self._ts_table("PRESET_ACCENTS")
        ts = {
            m[0]: {"light": m[1], "dark": m[2]}
            for m in re.findall(r"(\w+): \{ light: '(#[0-9a-f]{6})', dark: '(#[0-9a-f]{6})' \}", body)
        }
        assert ts == preset_accents()

    def test_themes_ts_neutral_tints_match_python(self):
        body = self._ts_table("NEUTRAL_TINTS")
        assert dict(re.findall(r"(\w+): '(#[0-9a-f]{6})'", body)) == NEUTRAL_TINTS

    def test_themes_ts_accent_mix_matches(self):
        assert "COLOR_PRESET_ACCENT_MIX = '4%'" in THEMES_TS.read_text(encoding="utf-8")

    def test_theme_css_resolves_mode_specific_accent(self):
        css = THEME_CSS.read_text(encoding="utf-8")
        assert "--seed-accent: var(--seed-accent-light, var(--seed-ink));" in css
        assert "--seed-accent: var(--seed-accent-dark, var(--seed-accent-light, var(--seed-ink)));" in css

    def test_theme_css_default_tint_matches_zinc(self):
        css = THEME_CSS.read_text(encoding="utf-8")
        assert f"--seed-tint: {NEUTRAL_TINTS['zinc']};" in css


class TestLegacyHslValidator:
    def test_finds_bare_triples(self):
        css = ":root{--primary: 221 83% 53%; --background:0 0% 100% !important}\n.dark{--card: 222.2 84% 4.9% / 0.8}"
        assert find_legacy_hsl_vars(css) == ["--primary", "--background", "--card"]

    def test_ignores_full_colours_and_other_vars(self):
        css = ":root{--primary: hsl(221 83% 53%); --db-bg: 0 0% 1%; --radius: 0.5rem; --seed-accent: #fff}"
        assert find_legacy_hsl_vars(css) == []
        assert find_legacy_hsl_vars(None) == []

    def test_validate_config_warns_but_stays_valid(self):
        config = Config(site=SiteConfig(title="T", custom_css=":root { --primary: 221 83% 53%; }"))
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_config(config)
        assert result.valid
        assert [w.code for w in result.warnings] == [5001]
        assert "--primary" in result.warnings[0].message
        assert any("--primary" in str(w.message) for w in caught)

    def test_validate_config_clean_css_has_no_warning(self):
        config = Config(site=SiteConfig(title="T", custom_css=":root { --seed-accent: #2563eb; }"))
        assert validate_config(config).warnings == []
