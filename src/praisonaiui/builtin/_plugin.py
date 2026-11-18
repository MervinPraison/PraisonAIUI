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
from typing import Any, Callable, Iterable, Optional, Union

from praisonaiui.plugin_registry import LayoutSpec, PageSpec

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
    host_routes: optional factory returning Starlette routes whose handlers
                 live in the host (``praisonaiui.server``) rather than in a
                 feature module. It is called lazily, only while the plugin
                 is on, so a disabled built-in leaves those paths unmounted.
                 These are not features: ``/api/features`` does not list them.
    layout_specs: the app shell layouts it provides (ADR 0003, see
                 :func:`layout_spec`); read by the ``layouts()`` hook.
    for_layouts: the layouts this plugin serves data to. While none of them
                 is available (and ``extensions.enabled`` does not name the
                 record), the record is ``disabled`` and its feature modules
                 are never imported.
    """

    name: str
    description: str = ""
    page_specs: PagesDecl = ()
    feature_refs: tuple[FeatureRef, ...] = ()
    dashboard_plugins: tuple[str, ...] = ()
    host_routes: Optional[Callable[[], list[Any]]] = None
    layout_specs: tuple[LayoutSpec, ...] = ()
    for_layouts: tuple[str, ...] = ()

    @property
    def required(self) -> bool:
        """True when the host needs part of this plugin (a required feature)."""
        return any(ref.required for ref in self.feature_refs)

    def _all_pages(self) -> list[PageSpec]:
        specs = self.page_specs() if callable(self.page_specs) else self.page_specs
        return list(specs)

    def pages(self) -> list[PageSpec]:
        """Its page-table pages (``/api/pages``, the dashboard, the shell)."""
        return [s for s in self._all_pages() if not s.shell_only]

    def shell_pages(self) -> list[PageSpec]:
        """Its ``shell_only`` pages: the app shell manifest only (ADR 0003)."""
        return [s for s in self._all_pages() if s.shell_only]

    def layouts(self) -> list[LayoutSpec]:
        return list(self.layout_specs)

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
    *,
    kind: str = "legacy",
    **extra: object,
) -> PageSpec:
    """A built-in page.

    ``kind="legacy"`` (the default): a vanilla view the shell mounts through
    the legacy host. ``kind="native"``: the app shell renders it with a React
    page registered by a first-party browser plugin (src/frontend/src/builtin);
    the legacy dashboard style ignores the kind. ``shell_only=True`` keeps
    the page out of the page table, ``/api/pages`` and the dashboard; with
    ``layouts=(...)`` the shell manifest carries it only while one of those
    layouts is available (ADR 0003).
    """
    return PageSpec(
        id=id,
        title=title,
        kind=kind,  # type: ignore[arg-type]
        icon=icon,
        group=group,
        description=description,
        order=order,
        source="builtin",
        **extra,  # type: ignore[arg-type]
    )


def layout_spec(
    id: str,
    title: str,
    description: str,
    order: float,
    *,
    home: str,
    primary: tuple[str, ...],
    look: Optional[str] = None,
) -> LayoutSpec:
    """A first-party layout (ADR 0003). Its frame is the browser descriptor
    ``src/frontend/src/builtin/layouts/<id>.ts``; ``home`` is the page ``/``
    opens and ``primary`` the default primary nav (YAML ``layout.primary``
    wins). ``look`` is the descriptor's ``meta.look``, painted from the first
    byte when the layout is the default."""
    return LayoutSpec(
        id=id,
        title=title,
        description=description,
        order=order,
        home=home,
        primary=primary,
        source="builtin",
        look=look,
    )
