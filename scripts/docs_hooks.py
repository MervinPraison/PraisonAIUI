"""mkdocs hook: patch pymdownx.highlight for pygments >= 2.20 compatibility.

Pygments 2.20 removed tolerance for ``filename=None`` in HtmlFormatter,
which pymdownx.highlight can pass when a code fence has no ``title``.

Without this patch, ANY untitled ```python``` block triggers::

    AttributeError: 'NoneType' object has no attribute 'replace'

Reference: https://github.com/facelessuser/pymdown-extensions/issues/XXXX
This is a drop-in fix: normalize ``filename`` to an empty string.
"""

from __future__ import annotations


def _patch_pymdownx_highlight() -> None:
    try:
        from pymdownx import highlight as _hi  # type: ignore
    except Exception:
        return

    if getattr(_hi, "_aiui_patched", False):
        return

    _orig_init = _hi.BlockHtmlFormatter.__init__

    def patched_init(self, **options):  # type: ignore
        if options.get("filename") is None:
            options["filename"] = ""
        _orig_init(self, **options)

    _hi.BlockHtmlFormatter.__init__ = patched_init
    _hi._aiui_patched = True


# Apply immediately when this module is loaded
_patch_pymdownx_highlight()


# mkdocs hook interface: provide at least one expected hook so mkdocs loads us.
def on_config(config, **kwargs):
    _patch_pymdownx_highlight()
    return config
