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
    PRO_ACCENT_KEYS,
    PRO_ACCENT_ROLES,
    PRO_ACCENTS,
    PRO_DEFAULT_ACCENT,
    PRO_NEUTRALS,
    get_pro_seed_css,
    get_seed_theme_css,
    inject_theme_css,
    preset_accents,
    pro_accent,
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


# ── PraisonAI Pro token system (ADR 0003 F4) ─────────────────────────────

PRO_CSS = Path("src/frontend/src/styles/pro.css")
INDEX_CSS = Path("src/frontend/src/index.css")
PRO_SCOPE = 'html[data-aiui-shell="react"][data-aiui-tokens="pro"]'


def _pro_rules() -> list[tuple[str, str]]:
    """(selector, body) for every rule inside pro.css's @layer base."""
    css = re.sub(r"/\*.*?\*/", "", PRO_CSS.read_text(encoding="utf-8"), flags=re.S)
    inner = css[css.index("@layer base") :]
    inner = inner[inner.index("{") + 1 : inner.rindex("}")]
    return [(s.strip(), b) for s, b in re.findall(r"([^{}]+)\{([^{}]*)\}", inner)]


def _pro_decls(body: str) -> dict[str, str]:
    return {k: " ".join(v.split()) for k, v in re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", body)}


def _pro_palette(mode: str) -> dict[str, str]:
    """The P0 `--pro-*` palette of one mode, read from pro.css."""
    body = _pro_rules()[0 if mode == "light" else 1][1]
    palette = {k[len("--pro-") :]: v for k, v in _pro_decls(body).items() if k.startswith("--pro-")}
    return {k: v for k, v in palette.items() if k not in PRO_ACCENT_ROLES}


class TestProTables:
    """pro.css, themes.ts and themes.py hold one Pro palette."""

    @pytest.mark.parametrize("mode", ["light", "dark"])
    def test_pro_css_palette_matches_python(self, mode):
        assert _pro_palette(mode) == PRO_NEUTRALS[mode]

    def test_pro_css_default_accent_seeds_are_the_default_swatch(self):
        d = _pro_decls(_pro_rules()[0][1])
        for mode in ("light", "dark"):
            for role in PRO_ACCENT_ROLES:
                assert d[f"--seed-pro-{role}-{mode}"] == PRO_ACCENTS[PRO_DEFAULT_ACCENT][mode][role]

    def test_themes_ts_neutrals_match_python(self):
        src = THEMES_TS.read_text(encoding="utf-8")
        body = src[src.index("export const PRO_NEUTRALS") :]
        body = body[: body.index("\n}\n")]
        light, dark = body.split("    dark: {")
        pairs = r"'([a-z-]+)': '([^']+)'"
        assert dict(re.findall(pairs, light)) == PRO_NEUTRALS["light"]
        assert dict(re.findall(pairs, dark)) == PRO_NEUTRALS["dark"]

    def test_themes_ts_accents_match_python(self):
        src = THEMES_TS.read_text(encoding="utf-8")
        body = src[src.index("export const PRO_ACCENTS") :]
        body = body[: body.index("\n}\n")]
        pairs = r"'([a-z-]+)': '([^']+)'"
        ts = {
            name: {"light": dict(re.findall(pairs, light)), "dark": dict(re.findall(pairs, dark))}
            for name, light, dark in re.findall(
                r"(\w+): \{\s*light: \{([^}]*)\},\s*dark: \{([^}]*)\},", body
            )
        }
        assert ts == PRO_ACCENTS
        assert f"PRO_DEFAULT_ACCENT: ProAccentName = '{PRO_DEFAULT_ACCENT}'" in src
        roles = "', '".join(PRO_ACCENT_ROLES)
        assert f"export const PRO_ACCENT_ROLES = ['{roles}'] as const" in src

    def test_swatch_keys_are_the_design_accent_options(self):
        # ProChat.dc.html data-props: accent options
        assert list(PRO_ACCENT_KEYS) == ["#4f46e5", "#2563eb", "#0f766e", "#18181b"]


class TestProScope:
    """pro.css can only paint a document that switched the Pro system on."""

    def test_every_rule_is_scoped_to_the_pro_app_shell(self):
        rules = _pro_rules()
        assert len(rules) >= 4
        for selector, _ in rules:
            for part in selector.split(","):
                assert part.strip().startswith(PRO_SCOPE), part

    def test_everything_is_inside_layer_base(self):
        css = re.sub(r"/\*.*?\*/", "", PRO_CSS.read_text(encoding="utf-8"), flags=re.S).strip()
        assert css.startswith("@layer base {") and css.endswith("}")
        assert css.count("@layer") == 1

    def test_not_loaded_by_index_css_and_classic_layer_untouched(self):
        assert "pro.css" not in INDEX_CSS.read_text(encoding="utf-8")
        theme = THEME_CSS.read_text(encoding="utf-8")
        assert "data-aiui-tokens" not in theme
        assert "--pro-" not in theme and "--seed-pro-" not in theme

    def test_seed_defaults_are_declared_on_html_only(self):
        # A descendant that re-declared the layered --seed-pro-* defaults would
        # hide the server's unlayered :root seeds (set_brand_color) below it.
        seeded = [
            selector
            for selector, body in _pro_rules()
            if any(name.startswith("--seed-pro-") for name in _pro_decls(body))
        ]
        assert seeded
        for selector in seeded:
            assert [part.strip() for part in selector.split(",")] == [PRO_SCOPE]

    def test_palette_lives_on_html_and_dark_subtrees_like_classic_seeds(self):
        allowed = {PRO_SCOPE, f"{PRO_SCOPE}.dark", f"{PRO_SCOPE} .dark"}
        for selector, body in _pro_rules():
            if any(name.startswith("--pro-") for name in _pro_decls(body)):
                assert {part.strip() for part in selector.split(",")} <= allowed, selector

    def test_mapping_recomputes_in_scopes_and_dark_subtrees(self):
        selector, body = _pro_rules()[2]
        parts = {part.strip() for part in selector.split(",")}
        assert parts == {PRO_SCOPE, f"{PRO_SCOPE} [data-aiui-scope]", f"{PRO_SCOPE} .dark"}
        assert "--primary" in _pro_decls(body)

    def test_accent_roles_read_runtime_seed_then_mode_seed(self):
        rules = _pro_rules()
        mapping = _pro_decls(rules[2][1])
        assert mapping["--primary"] == "var(--seed-pro-accent, var(--pro-accent))"
        assert mapping["--primary-foreground"] == "var(--seed-pro-accent-fg, var(--pro-accent-fg))"
        assert mapping["--ui-accent-soft"] == "var(--seed-pro-soft, var(--pro-soft))"
        assert mapping["--ui-link"] == "var(--seed-pro-link, var(--pro-link))"
        assert mapping["--ring"] == "var(--seed-pro-ring, var(--pro-ring))"
        light, dark = _pro_decls(rules[0][1]), _pro_decls(rules[1][1])
        for role in PRO_ACCENT_ROLES:
            assert light[f"--pro-{role}"] == f"var(--seed-pro-{role}-light)"
            assert dark[f"--pro-{role}"] == f"var(--seed-pro-{role}-dark)"

    def test_fonts_are_geist(self):
        mapping = _pro_decls(_pro_rules()[2][1])
        assert mapping["--aiui-font-sans"].startswith('"Geist", ui-sans-serif')
        assert mapping["--aiui-font-mono"].startswith('"Geist Mono", ui-monospace')


class TestProSeedCss:
    @pytest.mark.parametrize(
        "preset,accent",
        [
            (None, None),
            ("zinc", None),
            ("indigo", None),
            ("slate", None),
            ("ocean", None),
            ("zinc", PRESET_COLORS["zinc"]["accent"]),
            ("indigo", PRESET_COLORS["indigo"]["accent"]),
            ("zinc", "#4F46E5"),
        ],
    )
    def test_default_emits_nothing(self, preset, accent):
        assert get_pro_seed_css(preset, accent) == ""

    @pytest.mark.parametrize("preset", ["blue", "teal"])
    def test_presets_with_a_swatch(self, preset):
        d = _decls(get_pro_seed_css(preset))
        assert len(d) == 2 * len(PRO_ACCENT_ROLES)
        for mode in ("light", "dark"):
            for role in PRO_ACCENT_ROLES:
                assert d[f"--seed-pro-{role}-{mode}"] == PRO_ACCENTS[preset][mode][role]

    @pytest.mark.parametrize("key,swatch", sorted(PRO_ACCENT_KEYS.items()))
    def test_accent_key_hex_selects_its_swatch(self, key, swatch):
        assert pro_accent("zinc", key.upper()) is PRO_ACCENTS[swatch]

    def test_graphite_through_brand_colour(self):
        assert _decls(get_pro_seed_css("zinc", "#18181b"))["--seed-pro-ring-light"] == "#52525b"

    def test_other_colour_presets_derive_from_their_600_500_pair(self):
        d = _decls(get_pro_seed_css("rose"))
        assert d["--seed-pro-accent-light"] == PRESET_ACCENT_LIGHT["rose"]
        assert d["--seed-pro-accent-dark"] == PRESET_COLORS["rose"]["accent"]
        assert d["--seed-pro-soft-light"] == PRESET_ACCENT_LIGHT["rose"] + "14"
        assert d["--seed-pro-soft-dark"] == PRESET_COLORS["rose"]["accent"] + "29"

    def test_custom_short_hex_is_expanded(self):
        assert _decls(get_pro_seed_css("zinc", "#f60"))["--seed-pro-accent-light"] == "#ff6600"

    def test_functional_accent_uses_css_expressions(self):
        d = _decls(get_pro_seed_css("zinc", "oklch(0.6 0.2 250)"))
        assert d["--seed-pro-accent-light"] == "oklch(0.6 0.2 250)"
        assert d["--seed-pro-soft-light"].startswith("color-mix(")

    @pytest.mark.parametrize("bad", ["red;}body{color:red", "url(x)", "</style><script>", "#12"])
    def test_invalid_accent_is_ignored(self, bad, caplog):
        assert get_pro_seed_css("blue", accent=bad) == get_pro_seed_css("blue")
        assert "invalid theme accent" in caplog.text

    @pytest.mark.parametrize("preset", sorted(PRESET_NAMES))
    def test_only_pro_seeds_are_emitted(self, preset):
        css = get_pro_seed_css(preset, "#0077b6")
        assert set(_decls(css)) == {
            f"--seed-pro-{role}-{mode}" for mode in ("light", "dark") for role in PRO_ACCENT_ROLES
        }
        assert "</" not in css and ".dark" not in css and "--primary" not in css


class TestProServerTag:
    """style app: the configured accent reaches Pro through its own seed tag."""

    PRO_TAG = re.compile(r'<style id="aiui-server-pro-theme">(.*?)</style>', re.S)

    @pytest.fixture(autouse=True)
    def _server(self, tmp_path, monkeypatch):
        import praisonaiui.config_store as config_store
        import praisonaiui.server as srv

        monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
        monkeypatch.setattr(config_store, "_config_store", None)
        config_store.init_config_store(tmp_path / "config.yaml")
        srv.reset_state()
        yield srv
        srv.reset_state()

    def test_default_app_has_no_pro_tag(self, _server):
        _server.set_style("app")
        assert "aiui-server-pro-theme" not in _server._build_html("app")

    def test_preset_with_a_swatch(self, _server):
        _server.set_style("app")
        _server.set_theme(preset="blue")
        tag = self.PRO_TAG.search(_server._build_html("app")).group(1)
        assert tag == get_pro_seed_css("blue")
        assert _decls(tag)["--seed-pro-link-light"] == PRO_ACCENTS["blue"]["light"]["link"]

    def test_brand_colour_key_selects_teal(self, _server):
        _server.set_style("app")
        _server.set_brand_color("#0f766e")
        tag = self.PRO_TAG.search(_server._build_html("app")).group(1)
        assert _decls(tag)["--seed-pro-accent-dark"] == PRO_ACCENTS["teal"]["dark"]["accent"]
        # the classic seed tag still carries the brand colour for the classic frame
        assert "--seed-accent: #0f766e;" in _server._build_html("app")

    def test_dashboard_style_never_gets_pro_seeds(self, _server):
        _server.set_theme(preset="blue")
        _server.set_brand_color("#ff0000")
        assert "--seed-pro-" not in _server._build_html("dashboard")
