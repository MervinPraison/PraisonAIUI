"""Guardrails for light/dark contrast and the token-layer colour contract.

Since the token layer (ADR-0001 §7) shadcn variables are full colours consumed
as ``var(--x)``; ``hsl(var(--x))`` is invalid. The contrast tests below compute
WCAG ratios from the seeds and tier percentages in styles/theme.css, so a token
edit that drops text or accents below AA fails here.

The Content.tsx class assertions that used to live here moved to WP1's
tests/unit/test_markdown_contract.py (Content.tsx is rewritten on Streamdown).
"""

import math
import re
from pathlib import Path

import pytest

THEME_CSS = Path("src/frontend/src/styles/theme.css")
INDEX_CSS = Path("src/frontend/src/index.css")


# ── colour math (sRGB, OKLab, WCAG) ──────────────────────────────────────


def _hex(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _unlin(c: float) -> float:
    c = min(max(c, 0.0), 1.0)
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _luminance(rgb) -> float:
    r, g, b = (_lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a, b) -> float:
    la, lb = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _to_oklab(rgb):
    r, g, b = (_lin(c) for c in rgb)
    lms = (
        0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
        0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
        0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
    )
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in lms)
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def _from_oklab(lab):
    L, a, b = lab
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_**3, m_**3, s_**3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return tuple(_unlin(c) for c in (r, g, bb))


def _mix_oklab(c1, c2, p1: float):
    """color-mix(in oklab, c1 p1, c2) for opaque colours."""
    a, b = _to_oklab(c1), _to_oklab(c2)
    return _from_oklab(tuple(p1 * x + (1 - p1) * y for x, y in zip(a, b)))


def _over(fg, alpha: float, bg):
    """fg at `alpha` composited over an opaque bg (browsers blend in sRGB)."""
    return tuple(alpha * f + (1 - alpha) * b for f, b in zip(fg, bg))


def _oklch_clamp_l(rgb, lo=None, hi=None):
    L, a, b = _to_oklab(rgb)
    if lo is not None:
        L = max(L, lo)
    if hi is not None:
        L = min(L, hi)
    return _from_oklab((L, a, b))


def _auto_on(rgb):
    """The theme.css on-colour rule: black above luminance 0.1791, else white."""
    return (0.0, 0.0, 0.0) if _luminance(rgb) >= 0.1791 else (1.0, 1.0, 1.0)


# ── reading theme.css ─────────────────────────────────────────────────────


def _theme_css() -> str:
    """theme.css without comments (so prose in comments never matches a rule)."""
    return re.sub(r"/\*.*?\*/", "", THEME_CSS.read_text(encoding="utf-8"), flags=re.S)


def _block(css: str, selector: str) -> str:
    """Body of the first `selector {` block inside @layer base."""
    base = css[css.index("@layer base") :]
    m = re.search(r"(?m)^\s*" + re.escape(selector) + r"\s*\{([^}]*)\}", base)
    assert m, f"{selector} block not found in theme.css"
    return m.group(1)


def _var(block: str, name: str) -> str:
    m = re.search(r"--" + re.escape(name) + r"\s*:\s*([^;]+);", block)
    assert m, f"--{name} not found"
    return m.group(1).strip()


def _pct(css: str, name: str) -> float:
    """Ink percentage of an alpha tier such as --ui-text-3."""
    m = re.search(r"--" + re.escape(name) + r":[^;]*?var\(--ui-base\) ([\d.]+)%, transparent\)", css)
    assert m, f"--{name} is not an alpha tier of --ui-base"
    return float(m.group(1)) / 100


def _mode(dark: bool) -> dict:
    css = _theme_css()
    root = _block(css, ":root")
    seeds = {k: _var(root, k) for k in ("seed-ink", "seed-paper", "seed-sunken", "seed-raised", "seed-tint")}
    seeds["tint-mix"] = _var(root, "tint-mix")
    for k in ("seed-danger", "seed-success", "seed-warning", "seed-info"):
        seeds[k] = _var(root, k)
    if dark:
        d = _block(css, ".dark")
        for k in list(seeds):
            try:
                seeds[k] = _var(d, k)
            except AssertionError:
                pass
    tint_mix = float(seeds["tint-mix"].rstrip("%")) / 100
    paper = _hex(seeds["seed-paper"])
    neutral = _mix_oklab(_hex(seeds["seed-tint"]), paper, tint_mix)
    surfaces = {
        "app": neutral,
        "sidebar": _mix_oklab(_hex(seeds["seed-sunken"]), neutral, 0.70),
        "card": _mix_oklab(_hex(seeds["seed-raised"]), neutral, 0.70),
        "elevated": _hex(seeds["seed-raised"]),
    }
    ink = _hex(seeds["seed-ink"])
    surfaces["muted"] = _over(ink, _pct(css, "ui-fill-4"), surfaces["app"])
    return {"css": css, "seeds": seeds, "surfaces": surfaces, "ink": ink}


# ── token contract ────────────────────────────────────────────────────────


class TestTokenFormat:
    def test_prose_pre_code_uses_foreground_token(self):
        css = INDEX_CSS.read_text(encoding="utf-8")
        assert "--tw-prose-pre-code: var(--foreground)" in css

    def test_no_hsl_wrapped_tokens_anywhere_in_css(self):
        for path in (INDEX_CSS, THEME_CSS):
            assert "hsl(var(" not in path.read_text(encoding="utf-8"), path

    def test_theme_colors_are_full_colour_vars(self):
        css = _theme_css()
        assert "--color-background: var(--background)" in css
        assert "--color-sidebar: var(--sidebar)" in css
        assert "--sidebar: var(--ui-bg-sidebar)" in css
        index = INDEX_CSS.read_text(encoding="utf-8")
        assert '@import "./styles/theme.css"' in index
        # the old HSL @theme map is gone from index.css
        assert "--color-background" not in index

    def test_syntax_highlight_uses_full_colour_tokens(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/syntax-highlight.js").read_text(encoding="utf-8")
        assert "'var(--foreground)'" in source
        assert "'var(--muted)'" in source
        assert "hsl(var(" not in source
        assert "color: inherit !important" not in source
        assert "aiui:content-loaded" in source

    def test_mermaid_plugin_uses_full_colour_tokens(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/mermaid.js").read_text(encoding="utf-8")
        assert "hsl(var(" not in source
        assert "var(--muted)" in source

    @pytest.mark.xfail(
        "hsl(var(" in Path("src/praisonaiui/server.py").read_text(encoding="utf-8"),
        reason="server.py belongs to WP0c, which rewrites the docs anti-flicker to var(--x); "
        "until that lands the old wrapper resolves to an invalid colour",
        strict=True,
    )
    def test_server_anti_flicker_uses_theme_tokens(self):
        source = Path("src/praisonaiui/server.py").read_text(encoding="utf-8")
        start = source.index('id="aiui-anti-flicker"')
        anti_flicker = source[start : source.index("</style>", start)]
        assert "var(--background)" in anti_flicker
        assert "hsl(var(" not in anti_flicker
        assert "#0f172a" not in anti_flicker


class TestLegacyDashboardIsolation:
    """The dashboard style links /assets/index.css too; it must render as before."""

    REACT_DOC = ':where(html[data-aiui-shell], html:has(script[src*="/assets/index.js"]), html:has(script[src*="/src/main.tsx"]))'

    def test_element_rules_are_scoped_to_react_documents(self):
        css = _theme_css()
        base = css[css.index("@layer base") : css.index("@theme inline")]
        for rule in ("color-scheme:", "background-color:", "border-color:", "::selection"):
            for m in re.finditer(re.escape(rule), base):
                # find the selector that owns this declaration
                start = base.rfind("}", 0, m.start())
                selector = base[start + 1 : base.index("{", start + 1)].strip()
                if selector.startswith(".aiui-app"):
                    continue
                assert self.REACT_DOC in selector, f"unscoped {rule!r} rule: {selector}"

    def test_no_bare_html_body_or_star_rules(self):
        for path in (THEME_CSS, INDEX_CSS):
            css = path.read_text(encoding="utf-8")
            assert not re.search(r"(?m)^\s*(html|body|\*)\s*[,{]", css), path

    def test_preflight_font_stays_tailwind_default(self):
        css = _theme_css()
        assert '--default-font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji"' in css

    def test_no_db_bridge_in_theme_css(self):
        assert "--db-bg" not in _theme_css()  # the --db-* bridge is legacy/bridge.css (WP4)

    def test_dev_and_spike_sources_excluded(self):
        css = INDEX_CSS.read_text(encoding="utf-8")
        assert '@source not "../dev"' in css
        assert '@source not "./spike"' in css
        assert '@source "../node_modules/streamdown/dist/*.js"' in css


# ── WCAG AA contrast ─────────────────────────────────────────────────────


@pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
class TestContrast:
    def test_text_tiers_1_to_3_pass_aa_on_every_surface(self, dark):
        mode = _mode(dark)
        for tier in ("ui-text-1", "ui-text-2", "ui-text-3"):
            alpha = _pct(mode["css"], tier)
            for name, surface in mode["surfaces"].items():
                fg = _over(mode["ink"], alpha, surface)
                ratio = _contrast(fg, surface)
                assert ratio >= 4.5, f"{tier} on {name}: {ratio:.2f}"

    def test_semantic_colours_pass_aa_as_text(self, dark):
        mode = _mode(dark)
        for k in ("seed-danger", "seed-success", "seed-warning", "seed-info"):
            fg = _hex(mode["seeds"][k])
            for name in ("app", "card"):
                ratio = _contrast(fg, mode["surfaces"][name])
                assert ratio >= 4.5, f"{k} on {name}: {ratio:.2f}"

    def test_semantic_fills_get_aa_foreground(self, dark):
        mode = _mode(dark)
        for k in ("seed-danger", "seed-success", "seed-warning", "seed-info"):
            fill = _hex(mode["seeds"][k])
            assert _contrast(_auto_on(fill), fill) >= 4.5, k


def _preset_accents():
    from praisonaiui.themes import preset_accents

    return preset_accents()


class TestAccentContrast:
    def test_light_accents_are_600_shades_of_python_preset_colors(self):
        from praisonaiui.features.theme import PRESET_COLORS
        from praisonaiui.themes import NEUTRAL_TINTS

        accents = _preset_accents()
        assert set(accents) | set(NEUTRAL_TINTS) == set(PRESET_COLORS)
        for name, pair in accents.items():
            assert pair["dark"] == PRESET_COLORS[name]["accent"]
            # the 600 shade is darker than the 500 shade
            assert _luminance(_hex(pair["light"])) < _luminance(_hex(pair["dark"])), name

    @pytest.mark.parametrize("mode", ["light", "dark"])
    def test_primary_foreground_passes_aa_on_every_accent(self, mode):
        for name, pair in _preset_accents().items():
            fill = _hex(pair[mode])
            ratio = _contrast(_auto_on(fill), fill)
            assert ratio >= 4.5, f"{name} ({mode}): {ratio:.2f}"

    def test_auto_foreground_threshold_matches_theme_css(self):
        css = _theme_css()
        assert css.count("0.1791 - (0.2126 * r + 0.7152 * g + 0.0722 * b)") >= 15

    @pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
    def test_link_colour_passes_aa(self, dark):
        """--ui-link clamps the accent's OKLCH lightness (<= .5 light, >= .74 dark)."""
        css = _theme_css()
        assert "--ui-link: oklch(from var(--seed-accent) min(l, 0.5) c h);" in css
        assert "--ui-link: oklch(from var(--seed-accent) max(l, 0.74) c h);" in css
        mode = _mode(dark)
        for name, pair in _preset_accents().items():
            accent = _hex(pair["dark" if dark else "light"])
            link = _oklch_clamp_l(accent, lo=0.74) if dark else _oklch_clamp_l(accent, hi=0.5)
            ratio = _contrast(link, mode["surfaces"]["app"])
            assert ratio >= 4.5, f"{name} link ({'dark' if dark else 'light'}): {ratio:.2f}"

    @pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
    def test_focus_ring_is_visible(self, dark):
        """--ring mixes 70% accent with the ink: >= 3:1 against the page (WCAG 2.4.11)."""
        css = _theme_css()
        assert "--ui-focus: color-mix(in oklab, var(--ui-accent) 70%, var(--ui-base));" in css
        mode = _mode(dark)
        accents = [pair["dark" if dark else "light"] for pair in _preset_accents().values()]
        for accent in accents + [mode["seeds"]["seed-ink"]]:
            ring = _mix_oklab(_hex(accent), mode["ink"], 0.70)
            ratio = _contrast(ring, mode["surfaces"]["app"])
            assert ratio >= 3.0, f"ring for {accent}: {ratio:.2f}"


# ── legacy docs plugins (unchanged guardrails) ───────────────────────────


class TestLegacyDocsPlugins:
    def test_mermaid_heading_fix_scoped_to_dark(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/mermaid.js").read_text(encoding="utf-8")
        assert ".dark article.prose h1" in source
        assert ":root:not(.dark) article.prose h1" in source
        # Must not force near-white headings globally
        assert "article.prose h1, article.prose h2" not in source.replace(".dark article.prose h1", "")

    def test_content_loader_plugin_matches_react_prose_classes(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/content-loader.js").read_text(encoding="utf-8")
        assert "prose-neutral" in source
        assert "PROSE_ARTICLE_CLASS" in source
        assert 'class="my-2 text-foreground"' in source
        assert 'class="px-4 py-2 text-foreground"' in source

    def test_homepage_plugin_matches_react_prose_classes(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/homepage.js").read_text(encoding="utf-8")
        assert "prose-neutral" in source
        assert 'class="my-2 text-foreground"' in source

    def test_prose_contrast_rules_apply_without_prose_neutral(self):
        css = INDEX_CSS.read_text(encoding="utf-8")
        assert "article.prose :where(p, li, td, th" in css

    def test_index_html_theme_bootstrap_respects_storage(self):
        html = Path("src/praisonaiui/templates/frontend/index.html").read_text(encoding="utf-8")
        assert "aiui-theme-preference" in html
        assert "__AIUI_DARK_DEFAULT__" in html
