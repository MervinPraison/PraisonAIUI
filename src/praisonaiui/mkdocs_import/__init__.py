"""MkDocs → PraisonAI UI docs config importer.

This package is separate from the compiler and the ``aiui`` command. Import
it only when you are converting a MkDocs site.

Add or replace a step with ``register_handler``. A handler's ``name`` matches
a built-in (``site``, ``content``, ``theme``, ``nav``, ``plugins``,
``markdown``, ``extras``) to replace that step. A new name runs after them.
Set ``draft.overlay`` to add config keys this module does not know about.
"""

from praisonaiui.mkdocs_import.convert import convert_mkdocs, convert_mkdocs_text
from praisonaiui.mkdocs_import.handlers import builtin_handlers
from praisonaiui.mkdocs_import.model import (
    AiuiDraft,
    ConversionError,
    ConversionResult,
    Finding,
    MkDocsDocument,
)
from praisonaiui.mkdocs_import.registry import (
    HandlerRegistry,
    MkDocsHandler,
    get_registry,
    register_handler,
)

__all__ = [
    "AiuiDraft",
    "ConversionError",
    "ConversionResult",
    "Finding",
    "HandlerRegistry",
    "MkDocsDocument",
    "MkDocsHandler",
    "builtin_handlers",
    "convert_mkdocs",
    "convert_mkdocs_text",
    "get_registry",
    "register_handler",
]
