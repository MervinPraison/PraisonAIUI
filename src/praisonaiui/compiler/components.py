"""The site's own React components as docs tags (``<Pricing plan="pro" />``).

``site.components`` names one ES module beside aiui.yaml (or ``{src, tags}``).
It registers each tag with ``registerBlock`` from ``@aiui/sdk``, or exports a
component under the tag's name. A UI plugin's ``blocks()`` with a PascalCase
type are tags too, looked up only when a page uses a tag nothing else knows.

The build copies the module (a plugin's whole static folder), writes the
``react`` / ``@aiui/sdk`` shims the module imports under ``_aiui/externals/``
and an import map into every page, and lists tag -> module URL in
ui-config.json ``site.components``. The browser imports a module only on a
page that uses one of its tags (src/frontend/src/docs/CustomBlock.tsx).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from praisonaiui.compiler import branding
from praisonaiui.compiler.content_lint import ContentIssue
from praisonaiui.compiler.docs_tags import KNOWN_DOCS_TAGS

SHIMS = "_aiui/externals"
SUFFIXES = {".js", ".mjs"}
# registerBlock('Pricing', …) or `export function Pricing` / `export const Pricing`.
_FOUND = re.compile(
    r"registerBlock\(\s*['\"]([A-Z]\w*)['\"]"
    r"|export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Z]\w*)"
)


def is_tag(name: str) -> bool:
    """A component name: PascalCase with a lower-case letter, not a built-in tag."""
    return bool(re.fullmatch(r"[A-Z][A-Za-z0-9]*", name) and re.search("[a-z]", name)) and name not in KNOWN_DOCS_TAGS


@dataclass
class Components:
    tags: dict[str, str] = field(default_factory=dict)  # tag -> module URL (site path)
    files: dict[str, Path] = field(default_factory=dict)  # published path -> source file
    dirs: dict[str, Path] = field(default_factory=dict)  # published folder -> plugin static folder
    issues: list[ContentIssue] = field(default_factory=list)  # 7021


def collect(site, base: Path) -> Components:
    """``site.components`` (a SiteConfig's): its module and tags."""
    out = Components()
    value = site.components
    if value is None:
        return out
    src, declared = (value, []) if isinstance(value, str) else (value.src, value.tags)
    url = branding.asset_url(src, base, out.files, SUFFIXES)
    if url == src:
        out.issues.append(ContentIssue(
            7021, "site.components", 0, f"{src!r} is not a .js or .mjs file in the project folder",
            "Use a path relative to the config file, such as ./components/index.js"))
        return out
    path = out.files[url.lstrip("/")]
    names = declared or [a or b for a, b in _FOUND.findall(path.read_text(encoding="utf-8", errors="replace"))]
    names = [n for n in dict.fromkeys(names) if is_tag(n)]
    if not names:
        out.issues.append(ContentIssue(
            7021, "site.components", 0, f"{src!r} registers no component tag the build can find",
            "Name them: site.components: {src: ..., tags: [Pricing]}"))
    version = hashlib.sha256(path.read_bytes()).hexdigest()[:10]
    out.tags = {n: f"{url}?v={version}" for n in names}
    return out


def add_plugins(out: Components, wanted: set[str]) -> None:
    """Tags among ``wanted`` that an active UI plugin's ``blocks()`` render (imports plugins)."""
    from praisonaiui.plugin_registry import _resolve_asset, get_plugin_registry

    registry = get_plugin_registry()
    for rec, spec in registry._collect_pairs(registry.active(), "blocks", _resolve_asset):
        folder = registry.static_dir_of(rec)
        if spec.type in wanted and spec.type not in out.tags and folder and spec.module.startswith(f"/_plugins/{rec.name}/"):
            out.tags[spec.type] = spec.module
            out.dirs[f"_plugins/{rec.name}"] = folder


def write(out: Components, output_dir: Path) -> list[str]:
    """The ``react`` / ``@aiui/sdk`` shims and the plugin folders (the module itself goes with
    branding.publish); returns the files written."""
    import shutil

    from praisonaiui.server import _SHELL_EXTERNALS, _shell_external_js

    written = []
    for spec, slug in _SHELL_EXTERNALS.items():
        dst = output_dir / SHIMS / f"{slug}.js"
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(_shell_external_js(spec), encoding="utf-8")
        written.append(f"{SHIMS}/{slug}.js")
    for rel, folder in out.dirs.items():
        shutil.copytree(folder, output_dir / rel, dirs_exist_ok=True)
        written += sorted(f"{rel}/{p.relative_to(folder).as_posix()}" for p in folder.rglob("*") if p.is_file())
    return written


def import_map(url_base: str = "") -> str:
    """The ``<script type="importmap">`` that points the bare specifiers at the shims."""
    from praisonaiui.server import _SHELL_EXTERNALS, _shell_external_js
    from praisonaiui.utils import json_for_html

    imports = {}
    for spec, slug in _SHELL_EXTERNALS.items():
        version = hashlib.sha256(_shell_external_js(spec).encode()).hexdigest()[:10]
        imports[spec] = f"{url_base}/{SHIMS}/{slug}.js?v={version}"
    return f'<script type="importmap">{json_for_html({"imports": imports})}</script>'


def patch_page(page: str, script: str) -> str:
    """The import map first in ``<head>``: before any module script loads."""
    return page if 'type="importmap"' in page else page.replace("<head>", f"<head>\n  {script}", 1)
