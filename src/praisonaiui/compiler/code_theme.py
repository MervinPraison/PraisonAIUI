"""Code block theme and extra grammars of a docs build.

``site.theme.code`` picks the Shiki theme of code blocks: one name for both
colour modes, or ``{light, dark}``. Names are checked against ``aiui-code.json``
(written by the frontend build: every bundled theme with its background and
text colour). A chosen theme also sets ``--aiui-code-bg`` / ``--aiui-code-fg``
per mode in assets/theme.css, so the block is drawn on the theme's own
background; without one, code keeps the site's code background.

``site.theme.codeLanguages`` lists TextMate grammar files (JSON) beside
aiui.yaml. Each is published with the site and registered in the browser, on
first use, under its name and aliases.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from praisonaiui.compiler import branding
from praisonaiui.compiler.content_lint import ContentIssue
from praisonaiui.schema.models import CODE_NAME, CodeLanguageConfig, CodeThemeConfig

CODE_FILE = "aiui-code.json"
THEMES_URL = "https://shiki.style/themes"
_COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$")


@dataclass
class CodeTheme:
    """What a build adds for ``site.theme.code`` and ``site.theme.codeLanguages``."""

    config: dict = field(default_factory=dict)  # ui-config.json site.theme: code, codeLanguages
    css: str = ""  # appended to assets/theme.css
    issues: list[ContentIssue] = field(default_factory=list)  # 7014, 7015


@lru_cache(maxsize=4)
def _read(path: Path) -> dict[str, dict]:
    try:
        themes = json.loads(path.read_text(encoding="utf-8")).get("themes")
    except (OSError, ValueError, AttributeError):
        return {}
    return themes if isinstance(themes, dict) else {}


def bundled_themes() -> dict[str, dict]:
    """Theme name -> ``{type, bg, fg}`` for every theme the served frontend build bundles; empty without one."""
    from praisonaiui.compiler.compiler import Compiler

    return _read(Compiler._frontend_dirs()[0] / CODE_FILE)


def theme_pair(value) -> dict[str, str] | None:
    """``{light, dark}`` theme names of ``site.theme.code`` (one name serves both modes)."""
    if value is None:
        return None
    if isinstance(value, str):
        return {"light": value, "dark": value}
    if isinstance(value, CodeThemeConfig):
        return {"light": value.light, "dark": value.dark}
    return None


def _css(pair: dict[str, str], known: dict[str, dict]) -> str:
    rules = []
    for mode, selector in (("light", ":root"), ("dark", ":root.dark, :root .dark")):
        info = known.get(pair[mode]) or {}
        bg, fg = info.get("bg", ""), info.get("fg", "")
        if _COLOR.match(bg) and _COLOR.match(fg):
            rules.append(f"{selector} {{ --aiui-code-bg: {bg}; --aiui-code-fg: {fg}; }}")
    return "\n".join(rules) + "\n" if rules else ""


def _lang_id(value: object) -> str | None:
    v = value.strip().lower().replace(" ", "-") if isinstance(value, str) else ""
    return v if CODE_NAME.match(v) else None


def collect(theme, base: Path, files: dict[str, Path], url_base: str = "") -> CodeTheme:
    """Code theme and grammars of ``theme`` (a ThemeConfig or None). Grammar files are
    recorded in ``files`` for :func:`branding.publish`."""
    out = CodeTheme()
    if theme is None:
        return out
    pair = theme_pair(theme.code)
    if pair:
        known = bundled_themes()
        for mode in ("light", "dark"):
            name = pair[mode]
            if known and name not in known:
                near = difflib.get_close_matches(name, list(known), n=1)
                key = "site.theme.code" + ("" if isinstance(theme.code, str) else f".{mode}")
                out.issues.append(ContentIssue(
                    7015, key, 0, f"'{name}' is not a bundled code theme; {mode} mode uses github-{mode}",
                    (f"Did you mean '{near[0]}'? " if near else "") + f"Names: {THEMES_URL}"))
                pair[mode] = f"github-{mode}"
        out.config["code"] = pair
        out.css = _css(pair, known)

    langs = []
    for entry in theme.code_languages:
        cfg = CodeLanguageConfig(source=entry) if isinstance(entry, str) else entry
        url = branding.asset_url(cfg.source, base, files, {".json"})
        if not url or url == cfg.source:
            out.issues.append(ContentIssue(
                7014, "site.theme.codeLanguages", 0, f"grammar {cfg.source!r} is not a .json file in the project folder",
                "Use a path relative to the config file, such as grammars/mylang.tmLanguage.json"))
            continue
        src = files[url.lstrip("/")]
        try:
            grammar = json.loads(src.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            grammar = None
        if not isinstance(grammar, dict) or not isinstance(grammar.get("scopeName"), str):
            files.pop(url.lstrip("/"), None)
            out.issues.append(ContentIssue(
                7015, "site.theme.codeLanguages", 0, f"{cfg.source!r} is not a TextMate grammar (JSON with a scopeName)",
                "Export the grammar as .tmLanguage.json"))
            continue
        stem = src.name.split(".")[0]
        name = cfg.name or _lang_id(grammar.get("name")) or _lang_id(stem) or "custom"
        found = cfg.aliases or grammar.get("aliases") or grammar.get("fileTypes") or []
        aliases = sorted({a for a in map(_lang_id, found) if a and a != name})
        version = hashlib.sha256(src.read_bytes()).hexdigest()[:10]
        langs.append({"name": name, "aliases": aliases, "url": f"{url_base}{url}?v={version}"})
    if langs:
        out.config["codeLanguages"] = langs
    return out
