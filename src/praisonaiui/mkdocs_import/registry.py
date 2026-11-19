"""Handler registry. Extra handlers are added by name and can replace a built-in."""

from __future__ import annotations

from typing import Optional, Protocol

from praisonaiui.mkdocs_import.model import AiuiDraft, Finding, MkDocsDocument


class MkDocsHandler(Protocol):
    """One step of the conversion.

    Register a handler under an existing ``name`` to replace that step, or
    under a new name to run after the built-ins. Handlers must not import
    the compiler or start a server.
    """

    name: str

    def apply(
        self,
        doc: MkDocsDocument,
        draft: AiuiDraft,
        findings: list[Finding],
    ) -> None:
        """Read ``doc`` and update ``draft`` and ``findings``."""


class HandlerRegistry:
    """Ordered handlers. Registering the same ``name`` replaces that handler in place."""

    def __init__(self) -> None:
        self._handlers: list[MkDocsHandler] = []

    def register(self, handler: MkDocsHandler) -> None:
        for index, existing in enumerate(self._handlers):
            if existing.name == handler.name:
                self._handlers[index] = handler
                return
        self._handlers.append(handler)

    def handlers(self) -> list[MkDocsHandler]:
        return list(self._handlers)


_default: Optional[HandlerRegistry] = None


def get_registry() -> HandlerRegistry:
    """The process-wide registry, created with the built-in handlers on first use."""
    global _default
    if _default is None:
        from praisonaiui.mkdocs_import.handlers import builtin_handlers

        registry = HandlerRegistry()
        for handler in builtin_handlers():
            registry.register(handler)
        _default = registry
    return _default


def register_handler(handler: MkDocsHandler) -> None:
    """Add or replace a handler on the process-wide registry."""
    get_registry().register(handler)
