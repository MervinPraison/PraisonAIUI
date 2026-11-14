"""The first-party plugin type.

A :class:`BuiltinPlugin` is a plain declaration. It satisfies the same
duck-typed contract as a third-party plugin
(:class:`praisonaiui.plugin_registry.AiuiPlugin`): ``name`` plus the optional
``pages()`` hook. Nothing here imports the server.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable, Union

from praisonaiui.plugin_registry import PageSpec

#: Pages are either listed directly or built on first use (for a page whose
#: declaration needs an import the host should not pay for when it is disabled).
PagesDecl = Union[tuple[PageSpec, ...], Callable[[], Iterable[PageSpec]]]


@dataclass(frozen=True)
class BuiltinPlugin:
    """One first-party plugin: a domain's pages.

    name:        short id; the registry record is ``builtin.<name>``, which is
                 the name ``extensions.disabled`` takes.
    description: one line for listings.
    page_specs:  the pages it owns, in nav declaration order.
    dashboard_plugins: names of bundled ``dashboard-plugins`` folders that
                 belong to this plugin (they carry one of its pages). They are
                 switched off together with it.
    """

    name: str
    description: str = ""
    page_specs: PagesDecl = ()
    dashboard_plugins: tuple[str, ...] = ()

    def pages(self) -> list[PageSpec]:
        specs = self.page_specs() if callable(self.page_specs) else self.page_specs
        return list(specs)


def page(
    id: str,
    title: str,
    icon: str,
    group: str,
    description: str,
    order: int,
    **extra: object,
) -> PageSpec:
    """A legacy-hosted built-in page (vanilla view mounted by the shell)."""
    return PageSpec(
        id=id,
        title=title,
        kind="legacy",
        icon=icon,
        group=group,
        description=description,
        order=order,
        source="builtin",
        **extra,  # type: ignore[arg-type]
    )
