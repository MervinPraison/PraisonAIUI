"""The first-party plugin type.

A :class:`BuiltinPlugin` is a plain declaration. It satisfies the same
duck-typed contract as a third-party plugin
(:class:`praisonaiui.plugin_registry.AiuiPlugin`): ``name`` plus the optional
``pages()`` and ``features()`` hooks. Nothing here imports the server, and a
feature module is imported only when its plugin asks for it.
"""

from __future__ import annotations

import importlib
import logging
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Union

from praisonaiui.plugin_registry import PageSpec

#: Package that built-in feature modules are relative to.
FEATURES_PACKAGE = "praisonaiui.features"

# Same logger (and message) as the feature registry used before, so a broken
# feature module reads the same in the server log.
_log = logging.getLogger(FEATURES_PACKAGE)

#: Pages are either listed directly or built on first use (for a page whose
#: declaration needs an import the host should not pay for when it is disabled).
PagesDecl = Union[tuple[PageSpec, ...], Callable[[], Iterable[PageSpec]]]


@dataclass(frozen=True)
class FeatureRef:
    """A built-in feature protocol, named but not imported.

    module:   module path relative to :data:`FEATURES_PACKAGE` (``".chat"``).
    cls:      the ``BaseFeatureProtocol`` subclass in that module.
    required: the host itself depends on this feature (its routes or state),
              so it stays registered even when its plugin is disabled.
    """

    module: str
    cls: str
    required: bool = False

    def load(self) -> type:
        # importlib.import_module is looked up at call time on purpose (tests
        # patch it to simulate a broken module).
        mod = importlib.import_module(self.module, package=FEATURES_PACKAGE)
        return getattr(mod, self.cls)


def feature(module: str, cls: str, *, required: bool = False) -> FeatureRef:
    """Declare a built-in feature (see :class:`FeatureRef`)."""
    return FeatureRef(module, cls, required)


@dataclass(frozen=True)
class BuiltinPlugin:
    """One first-party plugin: a domain's pages and features.

    name:        short id; the registry record is ``builtin.<name>``, which is
                 the name ``extensions.disabled`` takes.
    description: one line for listings.
    page_specs:  the pages it owns, in nav declaration order.
    feature_refs: the feature protocols it owns (see :func:`feature`).
    dashboard_plugins: names of bundled ``dashboard-plugins`` folders that
                 belong to this plugin (they carry one of its pages). They are
                 switched off together with it.
    """

    name: str
    description: str = ""
    page_specs: PagesDecl = ()
    feature_refs: tuple[FeatureRef, ...] = ()
    dashboard_plugins: tuple[str, ...] = ()

    @property
    def required(self) -> bool:
        """True when the host needs part of this plugin (a required feature)."""
        return any(ref.required for ref in self.feature_refs)

    def pages(self) -> list[PageSpec]:
        specs = self.page_specs() if callable(self.page_specs) else self.page_specs
        return list(specs)

    def features(self) -> list[Any]:
        """Instances of every feature this plugin owns (the plugin is on)."""
        return _instantiate(self.feature_refs)

    def required_features(self) -> list[Any]:
        """Instances of the features the host needs even with the plugin off."""
        return _instantiate(ref for ref in self.feature_refs if ref.required)


def _instantiate(refs: Iterable[FeatureRef]) -> list[Any]:
    """Import and build each feature; a broken one is logged and skipped."""
    out: list[Any] = []
    for ref in refs:
        try:
            out.append(ref.load()())
        except Exception as exc:  # noqa: BLE001 - one module never blocks the rest
            _log.warning("Failed to register feature %s from %s: %s", ref.cls, ref.module, exc)
    return out


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
