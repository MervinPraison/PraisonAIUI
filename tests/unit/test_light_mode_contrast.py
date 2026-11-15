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


# ── PraisonAI Pro tokens (styles/pro.css, ADR 0003 F4) ───────────────────
# The Pro palette is explicit hex (themes.PRO_NEUTRALS / PRO_ACCENTS, kept equal
# to pro.css by test_seed_theme.py), so the ratios are computed directly.


def _pro_rgb(value: str, bg: str):
    """An opaque or #rrggbbaa colour as opaque RGB over ``bg``."""
    if len(value) == 9:
        return _over(_hex(value[:7]), int(value[7:9], 16) / 255, _hex(bg))
    return _hex(value)


def _pro_accent_cases():
    from praisonaiui.themes import PRESET_NAMES, PRO_ACCENTS, pro_accent

    cases = [(f"swatch:{name}", sw) for name, sw in PRO_ACCENTS.items()]
    cases += [(f"preset:{p}", pro_accent(p)) for p in PRESET_NAMES]
    # custom accents the server derives: very light, very dark, mid grey, saturated
    for custom in ("#ffff00", "#00ff00", "#000080", "#777777", "#ff00ff", "#ffffff", "#000000"):
        cases.append((f"custom:{custom}", pro_accent("zinc", custom)))
    return cases


@pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
class TestProContrast:
    def _n(self, dark):
        from praisonaiui.themes import PRO_NEUTRALS

        return PRO_NEUTRALS["dark" if dark else "light"]

    SURFACES = ("background", "card", "sidebar", "muted", "sidebar-accent")

    def test_text_roles_pass_aa_on_every_surface(self, dark):
        n = self._n(dark)
        for role in ("foreground", "muted-fg", "subtle", "sidebar-fg"):
            for surface in self.SURFACES:
                ratio = _contrast(_hex(n[role]), _hex(n[surface]))
                assert ratio >= 4.5, f"{role} on {surface}: {ratio:.2f}"

    def test_semantic_text_passes_aa_on_surfaces_and_its_soft_fill(self, dark):
        # Not on --muted: the design's danger is 4.39:1 there (DESIGN.md says so).
        n = self._n(dark)
        for k in ("success", "warning", "danger", "info"):
            for surface in ("background", "card", f"{k}-soft"):
                ratio = _contrast(_hex(n[k]), _hex(n[surface]))
                assert ratio >= 4.5, f"{k} on {surface}: {ratio:.2f}"

    def test_semantic_fills_have_aa_foregrounds(self, dark):
        n = self._n(dark)
        pairs = [("success", "success-fg"), ("warning", "warning-fg"), ("danger", "danger-fg"),
                 ("info", "background")]  # pro.css: --info-foreground is the page colour
        for fill, fg in pairs:
            ratio = _contrast(_hex(n[fg]), _hex(n[fill]))
            assert ratio >= 4.5, f"{fg} on {fill}: {ratio:.2f}"

    def test_code_background_keeps_text_readable(self, dark):
        n = self._n(dark)
        for role in ("foreground", "muted-fg", "subtle"):
            assert _contrast(_hex(n[role]), _hex(n["code-bg"])) >= 4.5, role

    @pytest.mark.parametrize("case", _pro_accent_cases(), ids=lambda c: c[0])
    def test_accent_roles_pass_aa(self, dark, case):
        _, resolved = case
        n = self._n(dark)
        a = resolved["dark" if dark else "light"]
        if not a["accent"].startswith("#"):
            pytest.skip("CSS-expression accent")
        fill = _hex(a["accent"])
        assert _contrast(_hex(a["accent-fg"]), fill) >= 4.5, "on-accent text"
        soft = _pro_rgb(a["soft"], n["background"])
        link = _hex(a["link"])
        for name in ("background", "card", "muted", "sidebar"):
            ratio = _contrast(link, _hex(n[name]))
            assert ratio >= 4.5, f"link on {name}: {ratio:.2f}"
        assert _contrast(link, soft) >= 4.5, "link on accent-soft"
        ring = _contrast(_hex(a["ring"]), _hex(n["background"]))
        assert ring >= 3.0, f"focus ring: {ring:.2f}"


# ── page templates (components/page/page.css, legacy/page-types.css) ────
# Both stylesheets use tokens only (page-types.test.ts, templates.test.tsx).
# These checks map each token to its Pro role and compute the ratios, so a
# template that puts a text role on a surface where it drops below AA, or a
# legacy view whose hard-coded dark surface survives into light mode under a
# light text token (Code Studio's output pane did), fails here.

TEMPLATE_CSS = (
    Path("src/frontend/src/components/page/page.css"),
    Path("src/frontend/src/legacy/page-types.css"),
)
CODE_STUDIO_JS = Path("src/praisonaiui/templates/frontend/plugins/views/code-studio.js")

# token -> PRO_NEUTRALS role (pro.css maps each token to that --pro-* value)
_TPL_TEXT = {
    "foreground": "foreground",
    "muted-foreground": "muted-fg",
    "ui-text-2": "muted-fg",
    "ui-text-3": "subtle",
    "sidebar-foreground": "sidebar-fg",
}
_TPL_SEMANTIC = {"success": "success", "warning": "warning", "destructive": "danger", "info": "info"}
# on-colours, only ever paired with their own fill (accent and semantic fill tests cover them)
_TPL_ON_FILL = {"primary-foreground": "primary", "warning-foreground": "warning", "destructive-foreground": "destructive"}
_TPL_SURFACE = {
    "background": "background",
    "card": "card",
    "popover": "card",
    "muted": "muted",
    "accent": "muted",
    "ui-row-hover": "muted",
    "ui-code-bg": "code-bg",
    "sidebar-accent": "sidebar-accent",
    "ui-success-soft": "success-soft",
    "ui-warning-soft": "warning-soft",
    "ui-danger-soft": "danger-soft",
    "ui-accent-soft": "accent-soft",
}
# solid fills: text on them is the matching on-colour, or none (dividers, dots)
_TPL_FILLS = {"primary", "warning", "destructive", "border"}
_TPL_KEYWORDS = {"inherit", "currentcolor", "transparent", "none"}


def _template_blocks(path: Path) -> list[tuple[str, dict[str, str]]]:
    """(selector, {property: value}) for every innermost rule, local vars resolved."""
    css = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
    local = dict(re.findall(r"--(tpl-[\w-]+)\s*:\s*([^;]+);", css))
    for name, value in local.items():
        css = css.replace(f"var(--{name})", value.strip())
    out = []
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        decls = {}
        for decl in body.split(";"):
            if ":" in decl:
                k, v = decl.split(":", 1)
                decls[k.strip().lower()] = v.replace("!important", "").strip()
        out.append((" ".join(sel.split()), decls))
    return out


def _token(value: str) -> str:
    """The first token a colour value names (``var(--x, …)`` -> ``x``), or the keyword."""
    m = re.match(r"var\(--([\w-]+)", value)
    return m.group(1) if m else value.lower()


def _template_decls(prop_re: str):
    for path in TEMPLATE_CSS:
        for sel, decls in _template_blocks(path):
            for k, v in decls.items():
                if re.fullmatch(prop_re, k):
                    yield path.name, sel, decls, _token(v)


def _accent_softs(n: dict, dark: bool):
    from praisonaiui.themes import PRO_ACCENTS

    for sw in PRO_ACCENTS.values():
        yield _pro_rgb(sw["dark" if dark else "light"]["soft"], n["background"])


class TestTemplateCss:
    def test_the_stylesheets_were_parsed(self):
        for path in TEMPLATE_CSS:
            assert len(_template_blocks(path)) > 40, path

    def test_text_colours_are_pro_text_roles(self):
        known = set(_TPL_TEXT) | set(_TPL_SEMANTIC) | set(_TPL_ON_FILL) | {"ui-link"} | _TPL_KEYWORDS
        bad = [f"{f}: {sel} -> {tok}" for f, sel, _, tok in _template_decls("color") if tok not in known]
        assert bad == []

    def test_backgrounds_are_pro_surfaces(self):
        known = set(_TPL_SURFACE) | _TPL_FILLS | _TPL_KEYWORDS
        bad = [
            f"{f}: {sel} -> {tok}"
            for f, sel, _, tok in _template_decls("background(-color)?")
            if tok not in known
        ]
        assert bad == []

    def test_on_colours_sit_on_their_own_fill(self):
        for f, sel, decls, tok in _template_decls("color"):
            if tok in _TPL_ON_FILL:
                bg = decls.get("background") or decls.get("background-color") or ""
                assert _token(bg) == _TPL_ON_FILL[tok], f"{f}: {sel}"

    @pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
    def test_every_text_role_passes_aa_on_every_template_surface(self, dark):
        from praisonaiui.themes import PRO_NEUTRALS

        n = PRO_NEUTRALS["dark" if dark else "light"]
        texts = {_TPL_TEXT[t] for *_, t in _template_decls("color") if t in _TPL_TEXT}
        surfaces = {_TPL_SURFACE[t] for *_, t in _template_decls("background(-color)?") if t in _TPL_SURFACE}
        assert {"foreground", "subtle", "muted-fg"} <= texts and "code-bg" in surfaces
        for role in sorted(texts):
            fg = _hex(n[role])
            for surface in sorted(surfaces):
                bgs = list(_accent_softs(n, dark)) if surface == "accent-soft" else [_hex(n[surface])]
                for bg in bgs:
                    ratio = _contrast(fg, bg)
                    assert ratio >= 4.5, f"{role} on {surface}: {ratio:.2f}"

    @pytest.mark.parametrize("dark", [False, True], ids=["light", "dark"])
    def test_semantic_text_passes_aa_on_its_rule_surface(self, dark):
        from praisonaiui.themes import PRO_NEUTRALS

        n = PRO_NEUTRALS["dark" if dark else "light"]
        for f, sel, decls, tok in _template_decls("color"):
            if tok not in _TPL_SEMANTIC:
                continue
            bg = _token(decls.get("background") or decls.get("background-color") or "transparent")
            # a rule without its own surface sits on the page or a card
            surfaces = ["background", "card"] if bg in _TPL_KEYWORDS else [_TPL_SURFACE[bg]]
            for surface in surfaces:
                ratio = _contrast(_hex(n[_TPL_SEMANTIC[tok]]), _hex(n[surface]))
                assert ratio >= 4.5, f"{f}: {sel}: {tok} on {surface}: {ratio:.2f}"

    def test_code_studio_dark_inline_surfaces_follow_the_scheme(self):
        """Every near-black surface Code Studio paints inline is re-pointed at a
        Pro surface by the editor template, so its theme-following text (the
        output tabs: --db-text, --db-text-dim) stays readable in light mode."""
        js = CODE_STUDIO_JS.read_text(encoding="utf-8")
        # Monaco's own canvas (and the textarea fallback with its own light text)
        # is dark in both schemes by design.
        assert "theme: 'vs-dark'" in js
        exempt = {"1e1e1e"}
        dark = {
            h.lower()
            for h in re.findall(r"background:\s*#([0-9a-fA-F]{6})", js)
            if _luminance(_hex(h)) < 0.05 and h.lower() not in exempt
        }
        assert {"0d1117", "18181b"} <= dark
        editor = [
            (sel, decls)
            for sel, decls in _template_blocks(TEMPLATE_CSS[1])
            if "[data-aiui-page-type='editor']" in sel
        ]
        for h in sorted(dark):
            rules = [d for sel, d in editor if f"'{h}'" in sel.lower() and "background:" in sel.lower()]
            assert rules, f"#{h} is not re-pointed under the editor template"
            assert all(_token(d.get("background", "")) in _TPL_SURFACE for d in rules), h


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
