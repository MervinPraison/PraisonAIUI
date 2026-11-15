"""aiui-layout-fixture: a third-party layout plugin, the same way any package ships one.

It contributes, to the React app shell (``style: app``):

* ``aurora`` - a layout frame (``static/aurora.js``, plain ESM, no build step)
  that calls ``registerLayout`` from ``@aiui/sdk``. The shell imports the file
  only when Aurora is the active layout (picked in the palette, in Settings ->
  Appearance, or with ``?layout=aurora``);
* ``broken`` - a layout whose frame always throws, so the e2e suite can check
  that the shell falls back to the classic frame with one toast.

The Python side only declares the layouts (``layouts()``, ADR 0003) and serves
its static files (``static_dir()``, at ``/_plugins/layoutfx/``). Used by
``e2e/specs/layouts-host.spec.ts`` and as the docs example in
``docs/features/plugins.md``.
"""

from __future__ import annotations

from pathlib import Path

__all__ = ["LayoutFixturePlugin", "plugin"]
__version__ = "0.1.0"

_STATIC = Path(__file__).parent / "static"

LAYOUTS = [
    {
        "id": "aurora",
        "title": "Aurora",
        "description": "A third-party layout: a slim rail and the page.",
        "module": "aurora.js",  # relative -> /_plugins/layoutfx/aurora.js
        "order": 90,
    },
    {
        "id": "broken",
        "title": "Broken",
        "description": "A layout whose frame always throws (fallback test).",
        "module": "broken.js",
        "order": 95,
    },
]


class LayoutFixturePlugin:
    """Duck-typed plugin (see praisonaiui.plugin_registry.AiuiPlugin)."""

    name = "layoutfx"
    version = __version__
    sdk = 1

    def layouts(self):
        # LayoutSpec (ADR 0003); on an aiui without it, dicts with its field names.
        try:
            from praisonaiui.plugin_registry import LayoutSpec
        except ImportError:
            return [dict(spec) for spec in LAYOUTS]
        return [LayoutSpec(**spec) for spec in LAYOUTS]

    def static_dir(self):
        return _STATIC  # served at /_plugins/layoutfx/


plugin = LayoutFixturePlugin()
