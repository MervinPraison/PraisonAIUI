"""Entry-point plugin registry for the React app shell (style ``app``).

Third-party packages extend the UI by declaring an entry point::

    # pyproject.toml of the plugin package
    [project.entry-points."praisonaiui.plugins"]
    kanban_pro = "kanban_pro:plugin"

The target may be a plugin instance, a class (instantiated with no args) or a
zero-arg factory. Every hook is optional; a plugin only implements what it
needs (duck-typed against :class:`AiuiPlugin`).

The Python side contributes pages, blocks, tool renderers, Starlette routes
(mounted at ``/api/plugins/<name>``), a static dir of ESM bundles (served at
``/_plugins/<name>/``), feature protocols and Typer CLI sub-apps. Browser
bundles are built against ``window.__AIUI_SDK__`` with React as an external.

Trust model
-----------
``pip install`` means trust: plugins run in-process, and their JS runs
same-origin with no sandbox (``kind="iframe"`` is the sandboxed option).
Because any package in the environment (including a transitive dependency)
can declare the entry point, the *browser* surfaces of entry-point plugins
(pages, blocks, tool renderers and the static dir) and its HTTP routes
(``/api/plugins/<name>/*``) are **default-deny** when the server requires
auth or is reached from a non-loopback address. In that case they are listed
with status ``disabled-by-default`` and only served for plugins named
explicitly in ``extensions.enabled`` / ``set_extensions(enabled=…)``. The
plugin's Python code (``setup()``, ``features()``) still runs once it is
installed: to keep a package's code from running at all, list it in
``extensions.disabled``.
Plugins registered in-process with :func:`register_plugin` were chosen by the
app author and are always trusted.

First-party plugins
-------------------
The pages and features that ship with PraisonAIUI are plugin records too
(:mod:`praisonaiui.builtin`), added with :meth:`PluginRegistry.register_builtin`.
Their record names are ``builtin.<name>`` and their origin is ``"builtin"``.
They are trusted and enabled unless named in ``extensions.disabled`` (an
``enabled`` allowlist only restricts third-party plugins). Third-party-facing
methods (``discover``, ``active``, ``pages()`` …) skip them unless asked with
``origin="builtin"`` / ``origin="all"``.

This module is distinct from :mod:`praisonaiui.plugins` (docs compiler hooks).
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import threading
from dataclasses import asdict, dataclass, field, replace
from importlib.metadata import EntryPoint, entry_points
from pathlib import Path
from typing import Any, Callable, Iterable, Literal, Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

ENTRY_POINT_GROUP = "praisonaiui.plugins"
SDK_API_VERSION = 1
AUTOLOAD_ENV = "AIUI_DISABLE_PLUGIN_AUTOLOAD"
SHELL_ENV = "AIUI_SHELL"

PageKind = Literal["native", "react", "blocks", "legacy", "iframe"]
PluginStatus = Literal["ok", "error", "disabled", "incompatible", "disabled-by-default"]
#: Where a plugin record came from. ``builtin`` = shipped with PraisonAIUI,
#: ``entry-point`` = pip-installed package, ``manual`` = register_plugin().
PluginOrigin = Literal["builtin", "entry-point", "manual"]
#: Filter for registry queries: one origin, ``third-party`` (entry-point and
#: manual, the default everywhere) or ``all``.
OriginFilter = Literal["builtin", "entry-point", "manual", "third-party", "all"]

BUILTIN_PREFIX = "builtin."

# Plugin names become URL path segments (/api/plugins/<name>, /_plugins/<name>).
_NAME_OK = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_NAME_BAD_CHARS = re.compile(r"[^a-z0-9_-]+")


def sanitize_plugin_name(raw: Any) -> Optional[str]:
    """Normalize a plugin name to ``[a-z0-9_-]`` (lowercase, max 64 chars).

    Runs of other characters become ``-``. Returns ``None`` when nothing
    usable is left.
    """
    name = _NAME_BAD_CHARS.sub("-", str(raw or "").strip().lower()).strip("-_")[:64]
    return name if _NAME_OK.match(name) else None


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(p.title() for p in rest)


def _to_wire(obj: Any) -> dict[str, Any]:
    return {_camel(k): v for k, v in asdict(obj).items() if v is not None}


# ── Specs (wire contract) ────────────────────────────────────────────


@dataclass(frozen=True)
class PageSpec:
    """One navigable page in the shell.

    kind:
      native  – built into the React shell (ported page)
      react   – ESM module from a plugin; ``module`` default-exports a component
      blocks  – server-driven ``{type, props, children}`` tree from ``api_endpoint``
      legacy  – vanilla view ``render(container)``/``cleanup()`` via registerView
      iframe  – sandboxed external URL (``module`` is the src)
    """

    id: str
    title: str
    kind: PageKind = "blocks"
    icon: str = "file"
    group: str = "Custom"
    order: int = 100
    description: str = ""
    module: Optional[str] = None
    export: Optional[str] = None
    css: Optional[str] = None
    api_endpoint: Optional[str] = None
    layout: Optional[str] = None
    position: Optional[str] = None
    integrity: Optional[str] = None
    css_integrity: Optional[str] = None
    source: str = "builtin"
    #: Inline SVG markup for the nav icon (the legacy dashboard prefers it over
    #: ``icon``). Trusted markup: only set it from code you control.
    icon_svg: Optional[str] = None
    #: App shell only: a lucide icon name for the sidebar (``navIcon`` on the
    #: wire), preferred over ``icon``. The legacy dashboard keeps ``icon``.
    nav_icon: Optional[str] = None
    #: App shell only: the shell's ``layout`` for a built-in page whose
    #: ``layout`` must stay unset for the legacy dashboard (``"full-bleed"``).
    shell_layout: Optional[str] = None
    #: The page exists only in the app shell manifest: never in the page
    #: table, ``GET /api/pages`` or the legacy dashboard (ADR 0003).
    shell_only: bool = False
    #: Layout-owned page (ADR 0003): the shell lists it in the nav only while
    #: one of these layouts is active (its URL renders under any layout).
    layouts: Optional[tuple[str, ...]] = None
    #: While a layout listing this page is active, it stands in for the page
    #: with this id (nav item and URL).
    replaces: Optional[str] = None
    #: App shell only: the page template (``pageType`` on the wire) the shell
    #: styles the page with: ``list``, ``board``, ``log``, ``editor``,
    #: ``gallery``, ``overview``, ``settings`` or ``chat`` (DESIGN.md "Page
    #: templates"). Built-in pages get theirs from ``builtin/page_types.py``.
    page_type: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d = _to_wire(self)
        d.pop("shellOnly", None)  # server-side routing only, never on the wire
        if self.layouts is not None:
            d["layouts"] = list(self.layouts)
        return d


#: Layout ids (ADR 0003). Same rule as the browser (``LAYOUT_ID_PATTERN``).
LAYOUT_ID = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
#: Reserved: the core's own frame. Never a registered layout.
CLASSIC_LAYOUT = "classic"


@dataclass(frozen=True)
class LayoutSpec:
    """A selectable app shell frame (ADR 0003), from a plugin's ``layouts()`` hook.

    A layout owns the frame around the routed page (navigation, session
    list, side panels). ``module`` is the ESM file whose code calls
    ``registerLayout(id, …)``; the shell imports it only while the layout is
    active. First-party layouts have no module (their browser descriptor is
    part of the bundle). ``home`` is the page ``/`` opens and ``primary``
    the page ids of the primary nav, in order (YAML ``layout.primary`` wins).
    """

    id: str
    title: str
    description: str = ""
    order: float = 100
    module: Optional[str] = None
    css: Optional[str] = None
    integrity: Optional[str] = None
    home: Optional[str] = None
    primary: Optional[tuple[str, ...]] = None
    source: str = "builtin"

    def to_dict(self) -> dict[str, Any]:
        d = _to_wire(self)
        if self.primary is not None:
            d["primary"] = list(self.primary)
        return d


@dataclass(frozen=True)
class BlockSpec:
    """Client renderer for a block ``type`` in the YAML/Python block tree."""

    type: str
    module: str
    export: Optional[str] = None
    integrity: Optional[str] = None
    source: str = "builtin"

    def to_dict(self) -> dict[str, Any]:
        return _to_wire(self)


@dataclass(frozen=True)
class ToolRendererSpec:
    """Client renderer for a tool call (feeds the chat Thread's tools.by_name)."""

    tool_name: str
    module: str
    export: Optional[str] = None
    integrity: Optional[str] = None
    source: str = "builtin"

    def to_dict(self) -> dict[str, Any]:
        return _to_wire(self)


SettingsFieldType = Literal["string", "text", "number", "boolean", "select"]
_FIELD_TYPES: tuple[str, ...] = ("string", "text", "number", "boolean", "select")
_FIELD_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_MAX_TEXT = 10_000


@dataclass(frozen=True)
class SettingsField:
    """One control of a plugin settings section (the shell renders it).

    type: ``string`` (one line), ``text`` (multi-line), ``number``,
    ``boolean`` (a switch) or ``select`` (one of ``options``). ``default``
    defaults to ``""``, ``0``, ``False`` or the first option.
    """

    key: str
    label: str = ""
    type: SettingsFieldType = "string"
    default: Any = None
    description: str = ""
    #: ``select`` only: the allowed values, as strings or ``{"value", "label"}`` dicts.
    options: Optional[tuple] = None


@dataclass(frozen=True)
class SettingsSectionSpec:
    """A settings section a plugin adds to the shell's settings dialog.

    Values are saved per plugin under ``AIUI_DATA_DIR/plugin-settings/`` and
    served at ``/api/plugins/<name>/settings/<id>`` (GET, PUT); Python code
    reads them with :func:`get_plugin_settings`.
    """

    id: str
    title: str
    fields: tuple = ()
    description: str = ""
    order: int = 100


@dataclass(frozen=True)
class NavGroupSpec:
    """A sidebar group a plugin's pages use (``PageSpec.group == name``).

    ``order`` places the group among the others: the groups the app lists in
    ``layout.groups.order`` sit at 100, 200, 300 …, groups with no order
    follow them, and ``layout.groups.last`` stays last. The app's own
    ``layout.groups`` always wins for a group it names. ``folded`` makes the
    group start collapsed.
    """

    name: str
    order: Optional[float] = None
    folded: bool = False


#: Tokens a plugin theme may set: the L0 seeds of ``styles/theme.css``.
_THEME_TOKEN = re.compile(r"^--(seed-[a-z0-9-]{1,40}|radius|tint-mix|accent-mix)$")
_THEME_VALUE = re.compile(r"^[#A-Za-z0-9 .,%()+\-/]{1,120}$")


@dataclass(frozen=True)
class ThemeSpec:
    """A theme preset: seed tokens for light and dark mode.

    ``light`` and ``dark`` map seed token names (``--seed-accent``,
    ``--seed-paper``, ``--radius`` …) to CSS values. The viewer picks the
    preset in the command palette; everything else derives from the seeds.
    """

    id: str
    label: str = ""
    light: Any = None
    dark: Any = None


@runtime_checkable
class AiuiPlugin(Protocol):
    """Duck-typed plugin contract. Only ``name`` is required."""

    name: str

    # Optional members (checked with getattr):
    #   version: str
    #   sdk: int                                  -> required SDK major (default 1)
    #   def pages(self) -> Iterable[PageSpec | dict]
    #   def blocks(self) -> Iterable[BlockSpec | dict]
    #   def tool_renderers(self) -> Iterable[ToolRendererSpec | dict]
    #   (dict specs accept snake_case or camelCase keys)
    #   def routes(self) -> list[starlette.routing.BaseRoute]   (mounted /api/plugins/<name>)
    #   def static_dir(self) -> Path | None                     (served /_plugins/<name>/)
    #   def features(self) -> Iterable[BaseFeatureProtocol]
    #   def cli_commands(self) -> typer.Typer | None
    #   def setup(self, ctx: dict) -> None                      (called once per create_app)
    # Added under SDK 1 (feature names "settings", "nav-groups", "theme-presets"):
    #   def settings(self) -> Iterable[SettingsSectionSpec | dict]
    #   def nav_groups(self) -> Iterable[NavGroupSpec | dict]
    #   def themes(self) -> Iterable[ThemeSpec | dict]
    # Added under SDK 1 (feature name "layouts", ADR 0003):
    #   def layouts(self) -> Iterable[LayoutSpec | dict]


@dataclass
class PluginRecord:
    name: str
    entry_point: str
    dist: Optional[str] = None
    version: Optional[str] = None
    status: PluginStatus = "ok"
    error: Optional[str] = None
    plugin: Any = field(default=None, repr=False)
    #: True for entry-point plugins (autoloaded), False for register_plugin()
    #: and for built-ins (both are trusted).
    autoloaded: bool = True
    origin: PluginOrigin = "entry-point"
    #: Built-ins only: the host itself depends on part of this plugin, so
    #: disabling it keeps the required part (see ``praisonaiui.builtin``).
    required: bool = False
    #: Why a built-in is ``disabled`` when the policy did not do it (for
    #: example ``"no layout needs it"`` for a layout-gated record).
    reason: Optional[str] = None

    def to_dict(self, *, status: Optional[str] = None, include_error: bool = True) -> dict[str, Any]:
        d: dict[str, Any] = {
            "name": self.name,
            "entryPoint": self.entry_point,
            "dist": self.dist,
            "version": self.version,
            "status": status or self.status,
            "origin": self.origin,
        }
        if self.required:
            d["required"] = True
        if self.reason:
            d["reason"] = self.reason
        if self.error and include_error:
            d["error"] = self.error
        return d


# ── Enable / disable policy ──────────────────────────────────────────


@dataclass
class ExtensionPolicy:
    """From YAML ``extensions:`` or :func:`set_extensions`.

    ``enabled=None`` → every installed entry point loads (pip-install == trust).
    ``enabled=[...]`` → strict allowlist. ``disabled`` always wins.
    """

    enabled: Optional[list[str]] = None
    disabled: list[str] = field(default_factory=list)

    @staticmethod
    def _norm(names: Iterable[str]) -> set[str]:
        out: set[str] = set()
        for n in names:
            out.add(str(n))
            s = sanitize_plugin_name(n)
            if s:
                out.add(s)
        return out

    def allows(self, *names: str) -> bool:
        disabled = self._norm(self.disabled)
        if any(n in disabled for n in names):
            return False
        return self.enabled is None or self.explicitly_enabled(*names)

    def allows_builtin(self, *names: str) -> bool:
        """First-party plugins are on unless named in ``disabled``.

        ``enabled`` is an allowlist for third-party plugins only, so
        ``extensions: [my-plugin]`` never switches the built-in pages off.
        """
        disabled = self._norm(self.disabled)
        return not any(n in disabled for n in self._norm(names))

    def explicitly_enabled(self, *names: str) -> bool:
        """True when one of ``names`` is listed in ``enabled`` (not just allowed)."""
        if self.enabled is None:
            return False
        enabled = self._norm(self.enabled)
        return any(n in enabled for n in names)

    @classmethod
    def from_config(cls, section: Any) -> "ExtensionPolicy":
        if isinstance(section, (list, tuple)):  # shorthand: extensions: [a, b]
            return cls(enabled=[str(x) for x in section])
        if not isinstance(section, dict):
            return cls()
        enabled = section.get("enabled")
        return cls(
            enabled=[str(x) for x in enabled] if isinstance(enabled, (list, tuple)) else None,
            disabled=[str(x) for x in section.get("disabled") or []],
        )


# ── Registry ─────────────────────────────────────────────────────────


class PluginRegistry:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._records: Optional[list[PluginRecord]] = None
        self._manual: list[Any] = []
        self._builtins: list[Any] = []
        self.policy = ExtensionPolicy()
        self._explicit = False

    # first-party plugins ----------------------------------------------
    def register_builtin(self, plugin: Any) -> None:
        """Add a first-party plugin (trusted, origin ``builtin``).

        Same duck-typed contract as any plugin. Registering a name again
        replaces the earlier object in place, so the call is idempotent.
        Only ``extensions.disabled`` switches a built-in off.
        """
        name = _builtin_name(plugin)
        with self._lock:
            for i, existing in enumerate(self._builtins):
                if _builtin_name(existing) == name:
                    self._builtins[i] = plugin
                    return
            self._builtins.append(plugin)

    def builtin_records(self) -> list[PluginRecord]:
        """One record per first-party plugin, in registration order.

        ``status`` is ``ok`` or ``disabled`` (per the current policy). The
        plugin object stays attached to a disabled record so the host can
        keep the parts it marked required.
        """
        with self._lock:
            builtins = list(self._builtins)
            policy = self.policy
        out: list[PluginRecord] = []
        for obj in builtins:
            name = _builtin_name(obj)
            out.append(
                PluginRecord(
                    name=name,
                    entry_point=f"praisonaiui.builtin:{name[len(BUILTIN_PREFIX):]}",
                    dist="praisonaiui",
                    version=getattr(obj, "version", None) or _host_version(),
                    status="ok" if policy.allows_builtin(name) else "disabled",
                    plugin=obj,
                    autoloaded=False,
                    origin="builtin",
                    required=bool(getattr(obj, "required", False)),
                )
            )
        self._gate_on_layouts(out, policy)
        return out

    def builtin_names(self) -> list[str]:
        """Record names of the first-party plugins (no policy, no gating)."""
        with self._lock:
            return [_builtin_name(obj) for obj in self._builtins]

    def _gate_on_layouts(self, records: list[PluginRecord], policy: ExtensionPolicy) -> None:
        """A built-in with ``for_layouts`` is on only while one of those
        layouts is available, or while ``extensions.enabled`` names it."""
        gated = [r for r in records if r.status == "ok" and _for_layouts(r.plugin)]
        if not gated:
            return
        from praisonaiui.layouts import available_layout_ids

        available = available_layout_ids(self, builtins=records)
        for rec in gated:
            if policy.explicitly_enabled(rec.name):
                continue
            if not available.intersection(_for_layouts(rec.plugin)):
                rec.status, rec.reason = "disabled", "no layout needs it"

    def records(self, origin: OriginFilter = "all") -> list[PluginRecord]:
        """Plugin records filtered by origin (built-ins first)."""
        out: list[PluginRecord] = []
        if origin in ("builtin", "all"):
            out.extend(self.builtin_records())
        if origin != "builtin":
            out.extend(
                r for r in self.discover() if origin in ("all", "third-party") or r.origin == origin
            )
        return out

    def unknown_builtin_names(self) -> list[str]:
        """``disabled`` entries that look like a built-in but match no record."""
        known = {sanitize_plugin_name(r.name) for r in self.records("all")}
        out = []
        for raw in self.policy.disabled:
            norm = sanitize_plugin_name(raw)
            if norm and norm.startswith("builtin-") and norm not in known:
                out.append(str(raw))
        return out

    # discovery ---------------------------------------------------------
    def _entry_points(self) -> Iterable[EntryPoint]:
        return entry_points(group=ENTRY_POINT_GROUP)

    def discover(self, *, refresh: bool = False) -> list[PluginRecord]:
        """Load every entry point once (cached). Failures are isolated."""
        with self._lock:
            if self._records is not None and not refresh:
                return self._records
            records: list[PluginRecord] = []
            seen: set[str] = set()
            autoload = os.environ.get(AUTOLOAD_ENV, "").strip().lower() not in ("1", "true", "yes")
            eps = list(self._entry_points()) if autoload else []
            for ep in eps:
                dist = getattr(ep, "dist", None)
                name = sanitize_plugin_name(ep.name)
                rec = PluginRecord(
                    name=name or str(ep.name),
                    entry_point=ep.value,
                    dist=getattr(dist, "name", None),
                    version=getattr(dist, "version", None),
                )
                if name is None:
                    rec.status, rec.error = "error", "invalid plugin name (allowed: a-z 0-9 _ -)"
                    records.append(rec)
                    continue
                if name in seen:
                    rec.status, rec.error = "error", "duplicate plugin name"
                    records.append(rec)
                    continue
                seen.add(name)
                if not self.policy.allows(ep.name, name):
                    rec.status = "disabled"  # never imported
                    records.append(rec)
                    continue
                try:
                    rec.plugin = _instantiate(ep.load())
                    self._check(rec)
                except Exception as exc:  # noqa: BLE001 - isolate third-party failure
                    logger.warning("aiui plugin %s failed to load: %s", name, exc)
                    rec.status, rec.error, rec.plugin = "error", f"{type(exc).__name__}: {exc}", None
                records.append(rec)
            for obj in self._manual:
                raw = getattr(obj, "name", None) or type(obj).__name__
                name = sanitize_plugin_name(raw)
                rec = PluginRecord(
                    name=name or str(raw),
                    entry_point="<register_plugin>",
                    plugin=obj,
                    version=getattr(obj, "version", None),
                    autoloaded=False,
                    origin="manual",
                )
                if name is None:
                    rec.status, rec.error, rec.plugin = (
                        "error",
                        "invalid plugin name (allowed: a-z 0-9 _ -)",
                        None,
                    )
                elif name in seen:
                    rec.status, rec.error, rec.plugin = "error", "duplicate plugin name", None
                elif not self.policy.allows(str(raw), name):
                    rec.status, rec.plugin = "disabled", None
                else:
                    try:
                        self._check(rec)
                    except Exception as exc:  # noqa: BLE001
                        rec.status, rec.error, rec.plugin = "error", f"{type(exc).__name__}: {exc}", None
                if name:
                    seen.add(name)
                records.append(rec)
            self._records = records
            return records

    @staticmethod
    def _check(rec: PluginRecord) -> None:
        p = rec.plugin
        want = int(getattr(p, "sdk", SDK_API_VERSION))
        if want != SDK_API_VERSION:
            rec.status = "incompatible"
            rec.error = f"plugin targets SDK v{want}, host is v{SDK_API_VERSION}"
            rec.plugin = None
        rec.version = rec.version or getattr(p, "version", None)

    def register(self, plugin: Any) -> None:
        """In-process registration (app.py / tests) without packaging."""
        with self._lock:
            self._manual.append(plugin)
            self._records = None

    def set_policy(self, policy: ExtensionPolicy, *, explicit: bool = True) -> None:
        with self._lock:
            self.policy = policy
            self._explicit = explicit
            self._records = None

    def apply_config(self, section: Any) -> None:
        """YAML ``extensions:``; ignored when set_extensions() was called."""
        with self._lock:
            if not self._explicit:
                self.set_policy(ExtensionPolicy.from_config(section), explicit=False)

    def reset(self) -> None:
        with self._lock:
            self._records = None
            self._manual.clear()
            self._builtins.clear()
            self.policy = ExtensionPolicy()
            self._explicit = False
        from praisonaiui import layouts  # set_layout() state lives there

        layouts.reset()

    def active(self) -> list[PluginRecord]:
        """Records whose plugin object loaded (Python surfaces are live)."""
        return [r for r in self.discover() if r.status == "ok" and r.plugin is not None]

    # browser-surface trust --------------------------------------------
    def js_allowed(self, rec: PluginRecord, *, restricted: bool) -> bool:
        """Whether ``rec``'s browser surfaces may be served.

        Unrestricted (loopback, no auth): every active plugin. Restricted:
        only in-process plugins and entry-point plugins listed explicitly in
        ``enabled``.
        """
        if rec.status != "ok" or rec.plugin is None:
            return False
        if not restricted or not rec.autoloaded:
            return True
        return self.policy.explicitly_enabled(rec.name)

    def js_active(self, *, restricted: bool) -> list[PluginRecord]:
        return [r for r in self.active() if self.js_allowed(r, restricted=restricted)]

    def records_for_manifest(
        self, *, restricted: bool, include_errors: bool = True
    ) -> list[dict[str, Any]]:
        out = []
        for rec in self.discover():
            status = rec.status
            if status == "ok" and not self.js_allowed(rec, restricted=restricted):
                status = "disabled-by-default"
            d = rec.to_dict(status=status, include_error=include_errors)
            if status == "ok":
                d.update(self.contributions(rec))
            out.append(d)
        return out

    # settings, nav groups, themes (shell contributions on the record) -----
    def contributions(self, rec: PluginRecord) -> dict[str, Any]:
        """Wire form of a plugin's ``settings()``, ``nav_groups()`` and
        ``themes()``, as extra keys of its manifest record (only non-empty
        ones, so records of plugins without them are unchanged)."""
        out: dict[str, Any] = {}
        sections = self.settings_sections(rec)
        if sections:
            out["settings"] = [
                {**_to_wire(s),
                 "fields": [
                     {**_to_wire(f), **({"options": list(f.options)} if f.options else {})}
                     for f in s.fields
                 ],
                 "endpoint": f"/api/plugins/{rec.name}/settings/{s.id}"}
                for s in sections
            ]
        groups = self._collect_from([rec], "nav_groups", _resolve_nav_group)
        if groups:
            out["navGroups"] = [_to_wire(g) for g in groups]
        themes = self._collect_from([rec], "themes", _resolve_theme)
        if themes:
            out["themes"] = [_to_wire(t) for t in themes]
        return out

    def settings_sections(self, rec: PluginRecord) -> list[SettingsSectionSpec]:
        """The valid sections of ``rec.settings()`` (first one wins per id)."""
        seen: set[str] = set()
        out: list[SettingsSectionSpec] = []
        for s in self._collect_from([rec], "settings", _resolve_settings_section):
            if s.id in seen:
                logger.warning("aiui plugin %s: duplicate settings section %r", rec.name, s.id)
                continue
            seen.add(s.id)
            out.append(s)
        return out

    def find_settings_section(self, plugin: str, section: str) -> Optional[SettingsSectionSpec]:
        for rec in self.active():
            if rec.name == plugin:
                return next((s for s in self.settings_sections(rec) if s.id == section), None)
        return None

    def _settings_routes(self, rec: PluginRecord) -> list:
        """``GET``/``PUT /settings/<section>`` for a plugin that declares settings."""
        if not self.settings_sections(rec):
            return []
        from starlette.requests import Request
        from starlette.responses import JSONResponse
        from starlette.routing import Route

        async def endpoint(request: Request) -> JSONResponse:
            spec = next(
                (s for s in self.settings_sections(rec) if s.id == request.path_params["section"]),
                None,
            )
            if spec is None:
                return JSONResponse({"error": "unknown settings section"}, status_code=404)
            if request.method == "GET":
                return JSONResponse({"values": read_settings_values(rec.name, spec)})
            try:
                body = await request.json()
            except ValueError:
                body = None
            values = body.get("values") if isinstance(body, dict) else None
            if not isinstance(values, dict):
                return JSONResponse({"error": 'expected {"values": {...}}'}, status_code=400)
            try:
                saved = save_settings_values(rec.name, spec, values)
            except SettingsError as exc:
                return JSONResponse({"error": str(exc), "fields": exc.fields}, status_code=400)
            return JSONResponse({"values": saved})

        return [Route("/settings/{section}", endpoint, methods=["GET", "PUT"])]

    # contributions -----------------------------------------------------
    def pages(
        self, *, restricted: bool = False, origin: OriginFilter = "third-party"
    ) -> list[PageSpec]:
        """Pages contributed by plugins.

        The default (``third-party``) is what entry-point and in-process
        plugins add. ``origin="builtin"`` returns the first-party pages of
        every enabled built-in, in registration order; ``"all"`` returns
        built-ins first. ``restricted`` only applies to third-party plugins.
        """
        out: list[PageSpec] = []
        if origin in ("builtin", "all"):
            out.extend(
                s
                for s in self._collect_from(self._enabled_builtins(), "pages", _resolve_builtin_page)
                if not s.shell_only  # the page table never holds a shell-only page
            )
        if origin != "builtin":
            recs = self.js_active(restricted=restricted)
            if origin in ("entry-point", "manual"):
                recs = [r for r in recs if r.origin == origin]
            out.extend(self._collect_from(recs, "pages", _resolve_page))
        return out

    def _enabled_builtins(self) -> list[PluginRecord]:
        return [r for r in self.builtin_records() if r.status == "ok"]

    # layouts (ADR 0003) ------------------------------------------------
    def layout_specs(
        self, *, restricted: bool = False, builtins: Optional[list[PluginRecord]] = None
    ) -> list[LayoutSpec]:
        """Every layout the enabled plugins declare with ``layouts()``:
        built-ins first, then third-party plugins whose browser surfaces are
        allowed (``restricted`` as in :meth:`js_allowed`). A repeated id
        keeps its first declaration and logs a warning.

        ``builtins`` is for the record gating, which passes the records it
        is still building.
        """
        own = self.builtin_records() if builtins is None else builtins
        recs = [r for r in own if r.status == "ok"] + self.js_active(restricted=restricted)
        out: list[LayoutSpec] = []
        owner: dict[str, str] = {}
        for rec, spec in self._collect_pairs(recs, "layouts", _resolve_layout):
            if spec.id in owner:
                logger.warning(
                    "aiui plugin %s: layout %r ignored, %s already provides it",
                    rec.name, spec.id, owner[spec.id],
                )
                continue
            owner[spec.id] = rec.name
            out.append(spec)
        return out

    def shell_pages(self, layout_ids: Optional[Iterable[str]]) -> list[PageSpec]:
        """The ``shell_only`` pages of the enabled built-ins (app shell
        manifest only). A page that names ``layouts`` is included only while
        one of them is in ``layout_ids``. Its ``source`` is the owning
        record (``builtin.layout-guided``), which the browser treats as
        built-in, so page-table built-ins stay the only ``"builtin"`` rows.
        ``layout_ids=None`` lists them all, unfiltered.
        """
        specs = self._collect_from(self._enabled_builtins(), "shell_pages", _resolve_shell_page)
        if layout_ids is None:
            return specs
        ids = set(layout_ids)
        return [s for s in specs if not s.layouts or ids.intersection(s.layouts)]

    def blocks(self, *, restricted: bool = False) -> list[BlockSpec]:
        return self._collect("blocks", _resolve_asset, restricted)

    def tool_renderers(self, *, restricted: bool = False) -> list[ToolRendererSpec]:
        return self._collect(
            "tool_renderers",
            lambda rec, spec: _resolve_asset(rec, spec, ToolRendererSpec),
            restricted,
        )

    def _collect(self, hook: str, resolve: Callable[[PluginRecord, Any], Any], restricted: bool) -> list:
        return self._collect_from(self.js_active(restricted=restricted), hook, resolve)

    @classmethod
    def _collect_from(
        cls, records: Iterable[PluginRecord], hook: str, resolve: Callable[[PluginRecord, Any], Any]
    ) -> list:
        return [spec for _rec, spec in cls._collect_pairs(records, hook, resolve)]

    @staticmethod
    def _collect_pairs(
        records: Iterable[PluginRecord], hook: str, resolve: Callable[[PluginRecord, Any], Any]
    ) -> list[tuple[PluginRecord, Any]]:
        """``(record, resolved spec)`` for every valid entry of ``hook``."""
        out: list[tuple[PluginRecord, Any]] = []
        for rec in records:
            fn = getattr(rec.plugin, hook, None)
            if not callable(fn):
                continue
            try:
                specs = list(fn() or ())
            except Exception as exc:  # noqa: BLE001
                logger.warning("aiui plugin %s.%s() failed: %s", rec.name, hook, exc)
                continue
            # One bad spec (unknown key, path escaping the static dir) must
            # not drop the plugin's other contributions.
            for spec in specs:
                try:
                    out.append((rec, resolve(rec, spec)))
                except Exception as exc:  # noqa: BLE001
                    logger.warning("aiui plugin %s: invalid %s entry %r: %s", rec.name, hook, spec, exc)
        return out

    def static_dir_of(self, rec: PluginRecord) -> Optional[Path]:
        fn = getattr(rec.plugin, "static_dir", None)
        try:
            d = fn() if callable(fn) else None
        except Exception as exc:  # noqa: BLE001
            logger.warning("aiui plugin %s.static_dir() failed: %s", rec.name, exc)
            return None
        if d and Path(d).is_dir():
            return Path(d).resolve()
        return None

    def static_dirs(self, *, restricted: bool = False) -> dict[str, Path]:
        out: dict[str, Path] = {}
        for rec in self.js_active(restricted=restricted):
            d = self.static_dir_of(rec)
            if d is not None:
                out[rec.name] = d
        return out

    def starlette_routes(self, is_restricted: Optional[Callable[[dict], bool]] = None) -> list:
        """Mount each plugin's routes and static dir under its own namespace.

        ``is_restricted(scope)`` decides per request whether browser surfaces
        are default-deny (see the module docstring). Static files of a plugin
        that is not allowed for that request answer 404.
        """
        from starlette.routing import Mount, Router
        from starlette.staticfiles import StaticFiles

        mounts: list = []
        for rec in self.active():
            fn = getattr(rec.plugin, "routes", None)
            sub: list = []
            if callable(fn):
                try:
                    sub = list(fn() or [])
                except Exception as exc:  # noqa: BLE001
                    logger.warning("aiui plugin %s.routes() failed: %s", rec.name, exc)
            # A plugin that declares settings() gets /settings/<section>
            # (reserved: it is matched before the plugin's own routes).
            sub = self._settings_routes(rec) + sub
            if sub:
                # Gated like the browser surfaces: a plugin listed as
                # "disabled-by-default" for this viewer answers 404
                # here too (enable it with extensions.enabled).
                mounts.append(
                    Mount(
                        f"/api/plugins/{rec.name}",
                        app=_GatedStatic(self, rec, Router(routes=sub), is_restricted),
                    )
                )
        for rec in self.active():
            d = self.static_dir_of(rec)
            if d is None:
                continue
            static = StaticFiles(directory=str(d))
            mounts.append(
                Mount(f"/_plugins/{rec.name}", app=_GatedStatic(self, rec, static, is_restricted))
            )
        return mounts

    def features(self) -> list:
        out: list = []
        for rec in self.active():
            fn = getattr(rec.plugin, "features", None)
            if callable(fn):
                try:
                    out.extend(fn() or ())
                except Exception as exc:  # noqa: BLE001
                    logger.warning("aiui plugin %s.features() failed: %s", rec.name, exc)
        return out

    def cli_apps(self) -> list[tuple[str, Any]]:
        out = []
        for rec in self.active():
            fn = getattr(rec.plugin, "cli_commands", None)
            try:
                app = fn() if callable(fn) else None
            except Exception as exc:  # noqa: BLE001
                logger.warning("aiui plugin %s.cli_commands() failed: %s", rec.name, exc)
                continue
            if app is not None:
                out.append((rec.name, app))
        return out


class _GatedStatic:
    """ASGI wrapper: serve a plugin's static dir or HTTP routes only when the
    plugin is allowed for this request (see ``js_allowed``)."""

    def __init__(self, registry: PluginRegistry, rec: PluginRecord, app: Any,
                 is_restricted: Optional[Callable[[dict], bool]]) -> None:
        self.registry = registry
        self.rec = rec
        self.app = app
        self.is_restricted = is_restricted

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or (
            scope["type"] == "websocket" and not hasattr(self.app, "routes")
        ):
            # static files have no sockets
            if scope["type"] == "websocket" and (await receive()).get("type") == "websocket.connect":
                await send({"type": "websocket.close", "code": 1008})
            return
        restricted = True
        try:
            restricted = bool(self.is_restricted(scope)) if self.is_restricted else False
        except Exception:  # noqa: BLE001 - fail closed
            restricted = True
        if not self.registry.js_allowed(self.rec, restricted=restricted):
            if scope["type"] == "websocket":
                if (await receive()).get("type") == "websocket.connect":
                    await send({"type": "websocket.close", "code": 1008})
                return
            from starlette.responses import PlainTextResponse

            await PlainTextResponse("Not Found", status_code=404)(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _builtin_name(plugin: Any) -> str:
    """Record name of a first-party plugin: ``builtin.<name>``."""
    raw = str(getattr(plugin, "name", None) or type(plugin).__name__).strip().lower()
    if raw.startswith(BUILTIN_PREFIX):
        raw = raw[len(BUILTIN_PREFIX):]
    name = sanitize_plugin_name(raw)
    if name is None:
        raise ValueError(f"invalid built-in plugin name {raw!r} (allowed: a-z 0-9 _ -)")
    return BUILTIN_PREFIX + name


def _host_version() -> Optional[str]:
    try:
        from praisonaiui.__version__ import __version__

        return __version__
    except Exception:  # noqa: BLE001
        return None


def _instantiate(obj: Any) -> Any:
    if isinstance(obj, type):
        return obj()
    if callable(obj) and not hasattr(obj, "name"):
        return obj()  # factory
    return obj


_SRI_CACHE: dict[str, tuple[tuple[int, int], str]] = {}


def _sri(path: Path) -> Optional[str]:
    """sha384 SRI of a file, cached by (mtime_ns, size).

    The manifest is rebuilt for every shell page load, so plugin bundles must
    not be re-read and re-hashed on each request.

    This is cache consistency, not tamper protection: a changed file gets a
    new matching hash (so a rebuilt bundle keeps loading). A plugin that
    wants a pinned hash declares ``integrity=`` on its spec.
    """
    try:
        st = path.stat()
        key, stamp = str(path), (st.st_mtime_ns, st.st_size)
        hit = _SRI_CACHE.get(key)
        if hit and hit[0] == stamp:
            return hit[1]
        digest = hashlib.sha384(path.read_bytes()).digest()
    except OSError:
        return None
    value = "sha384-" + base64.b64encode(digest).decode()
    _SRI_CACHE[key] = (stamp, value)
    return value


def _asset_url(rec: PluginRecord, module: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Relative module paths resolve into the plugin's static dir (+ SRI)."""
    if not module or module.startswith(("/", "http://", "https://")):
        return module, None
    fn = getattr(rec.plugin, "static_dir", None)
    raw = fn() if callable(fn) else None
    root = Path(raw).resolve() if raw else None
    if root is None:
        return module, None
    target = (root / module).resolve()
    if root not in target.parents:
        raise ValueError(f"module path escapes static dir: {module}")
    return f"/_plugins/{rec.name}/{Path(module).as_posix()}", _sri(target)


def _snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def _page_layout_fields(spec: PageSpec) -> dict[str, Any]:
    """Validated ``layouts`` (layout ids), ``replaces`` (a page id), ``shell_only``."""
    layouts = spec.layouts
    if layouts is not None:
        if isinstance(layouts, str) or not isinstance(layouts, (list, tuple)):
            raise ValueError("layouts must be a list of layout ids")
        layouts = tuple(_layout_id(v) for v in layouts)
    replaces = None if spec.replaces is None else _spec_id(spec.replaces, "replaces page id")
    from praisonaiui.builtin.page_types import validate_page_type

    return {
        "layouts": layouts,
        "replaces": replaces,
        "shell_only": bool(spec.shell_only),
        "page_type": validate_page_type(spec.page_type),
    }


def _resolve_page(rec: PluginRecord, spec: Any) -> PageSpec:
    if isinstance(spec, dict):
        # Accept wire-style camelCase keys too (apiEndpoint -> api_endpoint).
        spec = PageSpec(**{_snake(str(k)): v for k, v in spec.items()})
    layout_fields = _page_layout_fields(spec)
    module, sri = _asset_url(rec, spec.module)
    css, css_sri = _asset_url(rec, spec.css)
    api = spec.api_endpoint
    if spec.kind == "blocks" and not api:
        api = f"/api/plugins/{rec.name}/pages/{spec.id}"
    return PageSpec(
        **{
            **asdict(spec),
            "module": module,
            "css": css,
            "api_endpoint": api,
            "integrity": spec.integrity or sri,
            "css_integrity": spec.css_integrity or css_sri,
            "source": f"plugin:{rec.name}",
            # Inline SVG is first-party only: it is injected as markup.
            "icon_svg": None,
            **layout_fields,
        }
    )


def _resolve_builtin_page(rec: PluginRecord, spec: Any) -> PageSpec:
    """First-party pages are used as declared (source stays ``builtin``)."""
    if isinstance(spec, dict):
        spec = PageSpec(**{_snake(str(k)): v for k, v in spec.items()})
    if not isinstance(spec, PageSpec):
        raise TypeError(f"expected PageSpec, got {type(spec).__name__}")
    from praisonaiui.builtin.page_types import apply_page_type

    spec = apply_page_type(spec)
    return spec if spec.source == "builtin" else replace(spec, source="builtin")


def _resolve_shell_page(rec: PluginRecord, spec: Any) -> PageSpec:
    """A first-party shell-only page; ``source`` names its record."""
    spec = _resolve_builtin_page(rec, spec)
    return replace(spec, **{**_page_layout_fields(spec), "shell_only": True}, source=rec.name)


def _layout_id(value: Any) -> str:
    if not isinstance(value, str) or not LAYOUT_ID.match(value) or value == CLASSIC_LAYOUT:
        raise ValueError(
            f"invalid layout id {value!r} (a-z, 0-9 and -, starting with a letter, "
            f"at most 40 characters; {CLASSIC_LAYOUT!r} is reserved)"
        )
    return value


def _resolve_layout(rec: PluginRecord, spec: Any) -> LayoutSpec:
    s = _from_dict(LayoutSpec, spec)
    lid = _layout_id(s.id)
    order = s.order
    if isinstance(order, bool) or not isinstance(order, (int, float)) or order != order:
        raise ValueError(f"layout {lid!r}: order must be a number")
    primary = s.primary
    if primary is not None:
        if isinstance(primary, str) or not isinstance(primary, (list, tuple)):
            raise ValueError(f"layout {lid!r}: primary must be a list of page ids")
        primary = tuple(_spec_id(p, "primary page id") for p in primary)
    home = None if s.home is None else _spec_id(s.home, "home page id")
    builtin = rec.origin == "builtin"
    # First-party layouts ship in the bundle; a plugin's module and css
    # resolve into its static dir like its pages do.
    module, sri = (s.module, None) if builtin else _asset_url(rec, s.module)
    css = s.css if builtin else _asset_url(rec, s.css)[0]
    if not builtin and not module:
        raise ValueError(f"layout {lid!r}: a plugin layout needs a module (its ESM file)")
    return LayoutSpec(
        id=lid,
        title=_short_text(s.title or lid, "title", 64),
        description=_short_text(s.description or "", "description", 500),
        order=order,
        module=module,
        css=css,
        integrity=s.integrity or sri,
        home=home,
        primary=primary,
        source="builtin" if builtin else f"plugin:{rec.name}",
    )


def _for_layouts(plugin: Any) -> tuple[str, ...]:
    """A built-in's ``for_layouts``: the layouts it serves data to (ADR 0003)."""
    value = getattr(plugin, "for_layouts", None) or ()
    return (value,) if isinstance(value, str) else tuple(str(v) for v in value)


def _resolve_asset(rec: PluginRecord, spec: Any, spec_type: type = BlockSpec):
    if isinstance(spec, dict):
        spec = spec_type(**{_snake(str(k)): v for k, v in spec.items()})
    module, sri = _asset_url(rec, spec.module)
    return type(spec)(
        **{
            **asdict(spec),
            "module": module,
            "integrity": spec.integrity or sri,
            "source": f"plugin:{rec.name}",
        }
    )


def _from_dict(spec_type: type, spec: Any) -> Any:
    if isinstance(spec, dict):
        return spec_type(**{_snake(str(k)): v for k, v in spec.items()})
    if not isinstance(spec, spec_type):
        raise TypeError(f"expected {spec_type.__name__} or dict, got {type(spec).__name__}")
    return spec


def _short_text(value: Any, what: str, limit: int = 200) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{what} must be a string")
    return value.strip()[:limit]


def _spec_id(value: Any, what: str) -> str:
    if not isinstance(value, str) or not _NAME_OK.match(value):
        raise ValueError(f"invalid {what} {value!r} (allowed: a-z 0-9 _ -)")
    return value


def _option_values(options: Any) -> tuple[tuple[str, str], ...]:
    """``select`` options as ``(value, label)`` pairs."""
    out: list[tuple[str, str]] = []
    for o in options or ():
        if isinstance(o, str):
            out.append((o, o))
        elif isinstance(o, dict) and isinstance(o.get("value"), str):
            out.append((o["value"], _short_text(o.get("label", o["value"]), "option label")))
        else:
            raise ValueError(f"invalid select option {o!r}")
    if not out:
        raise ValueError("a select field needs options")
    return tuple(out)


_TYPE_DEFAULTS: dict[str, Any] = {"string": "", "text": "", "number": 0, "boolean": False}


def _resolve_field(spec: Any) -> SettingsField:
    f = _from_dict(SettingsField, spec)
    if not isinstance(f.key, str) or not _FIELD_KEY.match(f.key):
        raise ValueError(f"invalid settings field key {f.key!r}")
    if f.type not in _FIELD_TYPES:
        raise ValueError(f"field {f.key!r}: unknown type {f.type!r} (allowed: {', '.join(_FIELD_TYPES)})")
    options = None
    if f.type == "select":
        pairs = _option_values(f.options)
        options = tuple({"value": v, "label": label} for v, label in pairs)
        default = pairs[0][0] if f.default is None else f.default
    else:
        default = _TYPE_DEFAULTS[f.type] if f.default is None else f.default
    field_ = replace(
        f,
        label=_short_text(f.label or f.key, "label"),
        description=_short_text(f.description or "", "description", 500),
        options=options,
        default=default,
    )
    return replace(field_, default=_coerce_value(field_, default))


def _resolve_settings_section(rec: PluginRecord, spec: Any) -> SettingsSectionSpec:
    s = _from_dict(SettingsSectionSpec, spec)
    fields = tuple(_resolve_field(f) for f in s.fields or ())
    keys = [f.key for f in fields]
    if len(set(keys)) != len(keys):
        raise ValueError(f"section {s.id!r}: duplicate field keys")
    if not fields:
        raise ValueError(f"section {s.id!r} has no fields")
    return SettingsSectionSpec(
        id=_spec_id(s.id, "settings section id"),
        title=_short_text(s.title, "title"),
        fields=fields,
        description=_short_text(s.description or "", "description", 500),
        order=int(s.order),
    )


def _resolve_nav_group(rec: PluginRecord, spec: Any) -> NavGroupSpec:
    g = _from_dict(NavGroupSpec, spec)
    name = _short_text(g.name, "nav group name", 64)
    if not name:
        raise ValueError("a nav group needs a name")
    order = g.order
    if order is not None and (isinstance(order, bool) or not isinstance(order, (int, float))):
        raise ValueError(f"nav group {name!r}: order must be a number")
    if order is not None and order != order:  # NaN
        raise ValueError(f"nav group {name!r}: order must be a number")
    return NavGroupSpec(name=name, order=order, folded=bool(g.folded))


def _theme_tokens(raw: Any, where: str) -> dict[str, str]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError(f"{where} must be a dict of seed tokens")
    out: dict[str, str] = {}
    for k, v in raw.items():
        name = str(k)
        if not name.startswith("--"):
            name = f"--{name}"
        value = str(v).strip()
        if not _THEME_TOKEN.match(name):
            raise ValueError(f"{where}: {k!r} is not a seed token (--seed-*, --radius, --tint-mix, --accent-mix)")
        if not _THEME_VALUE.match(value) or "url(" in value.lower():
            raise ValueError(f"{where}: unsafe value for {name}: {v!r}")
        out[name] = value
    return out


def _resolve_theme(rec: PluginRecord, spec: Any) -> ThemeSpec:
    t = _from_dict(ThemeSpec, spec)
    tid = _spec_id(t.id, "theme id")
    light = _theme_tokens(t.light, f"theme {tid!r} light")
    dark = _theme_tokens(t.dark, f"theme {tid!r} dark")
    if not light and not dark:
        raise ValueError(f"theme {tid!r} sets no tokens")
    return ThemeSpec(id=tid, label=_short_text(t.label or tid, "label", 64), light=light, dark=dark)


# ── Plugin settings values ───────────────────────────────────────────


class SettingsError(ValueError):
    """Values that do not fit a settings section; ``fields`` maps key → reason."""

    def __init__(self, message: str, fields: dict[str, str]) -> None:
        super().__init__(message)
        self.fields = fields


def _coerce_value(f: SettingsField, value: Any) -> Any:
    if f.type in ("string", "text"):
        if not isinstance(value, str):
            raise ValueError("expected text")
        if len(value) > _MAX_TEXT:
            raise ValueError(f"longer than {_MAX_TEXT} characters")
        return value if f.type == "text" else value.replace("\n", " ")
    if f.type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
            raise ValueError("expected a number")
        if value in (float("inf"), float("-inf")):
            raise ValueError("expected a finite number")
        return value
    if f.type == "boolean":
        if not isinstance(value, bool):
            raise ValueError("expected true or false")
        return value
    allowed = [o["value"] for o in f.options or ()]
    if value not in allowed:
        raise ValueError(f"expected one of {', '.join(allowed)}")
    return value


_settings_lock = threading.Lock()


def _settings_file(plugin: str) -> Path:
    name = sanitize_plugin_name(plugin)
    if name is None:
        raise ValueError(f"invalid plugin name {plugin!r}")
    base = Path(os.environ.get("AIUI_DATA_DIR", str(Path.home() / ".praisonaiui")))
    return base / "plugin-settings" / f"{name}.json"


def _read_settings_file(plugin: str) -> dict[str, Any]:
    import json

    try:
        data = json.loads(_settings_file(plugin).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        logger.warning("aiui plugin %s: unreadable settings file: %s", plugin, exc)
        return {}
    return data if isinstance(data, dict) else {}


def read_settings_values(plugin: str, spec: SettingsSectionSpec) -> dict[str, Any]:
    """Saved values of ``spec`` with defaults for keys never saved (or no longer valid)."""
    with _settings_lock:
        stored = _read_settings_file(plugin).get(spec.id)
    stored = stored if isinstance(stored, dict) else {}
    out: dict[str, Any] = {}
    for f in spec.fields:
        value = f.default
        if f.key in stored:
            try:
                value = _coerce_value(f, stored[f.key])
            except ValueError:
                pass  # e.g. an option the plugin has since removed
        out[f.key] = value
    return out


def save_settings_values(plugin: str, spec: SettingsSectionSpec, values: dict) -> dict[str, Any]:
    """Validate ``values`` (a partial update) against ``spec`` and save them.

    Raises :class:`SettingsError` naming each bad key; nothing is written then.
    Returns the section's values after the save.
    """
    import json
    import tempfile

    by_key = {f.key: f for f in spec.fields}
    errors: dict[str, str] = {}
    clean: dict[str, Any] = {}
    for key, value in values.items():
        f = by_key.get(str(key))
        if f is None:
            errors[str(key)] = "unknown setting"
            continue
        try:
            clean[f.key] = _coerce_value(f, value)
        except ValueError as exc:
            errors[f.key] = str(exc)
    if errors:
        raise SettingsError("invalid settings", errors)
    path = _settings_file(plugin)
    with _settings_lock:
        data = _read_settings_file(plugin)
        section = data.get(spec.id) if isinstance(data.get(spec.id), dict) else {}
        data[spec.id] = {**section, **clean}
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, sort_keys=True)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
    return read_settings_values(plugin, spec)


def get_plugin_settings(plugin: str, section: str) -> dict[str, Any]:
    """The values of a plugin's settings section, for the plugin's Python code.

    Declared defaults fill in keys the viewer never saved. For a section the
    plugin does not (or no longer) declare, the raw saved values are returned.
    """
    spec = get_plugin_registry().find_settings_section(sanitize_plugin_name(plugin) or plugin, section)
    if spec is not None:
        return read_settings_values(plugin, spec)
    with _settings_lock:
        stored = _read_settings_file(plugin).get(section)
    return dict(stored) if isinstance(stored, dict) else {}


# ── Shell selection ──────────────────────────────────────────────────

SHELL_STYLES = ("app",)


def resolve_shell_style(style: str) -> str:
    """Apply the ``AIUI_SHELL`` env override.

    - ``AIUI_SHELL=app`` (alias ``react``): opt in. The ``dashboard`` style
      becomes ``app``.
    - ``AIUI_SHELL=legacy``: kill switch once the default flips. ``app``
      becomes ``dashboard``.
    - Explicit non-dashboard styles (chat, docs, agents, playground, custom)
      are never rewritten.

    Decision for P0/P1 (recorded before the P2 flip): an explicit
    ``set_style("dashboard")`` (for example the PraisonAI wrapper's
    ``host_app.py`` and ``features/replay.py``) means "the product dashboard",
    not "the legacy UI". It therefore follows ``AIUI_SHELL=app`` like the
    implicit default does, and at P2 the wrapper keeps getting the product UI
    by switching its explicit style to ``app`` (or by the flip of this
    function's mapping). ``AIUI_SHELL=legacy`` stays the only way to force the
    vanilla dashboard.
    """
    mode = os.environ.get(SHELL_ENV, "").strip().lower()
    if mode in ("app", "react") and style == "dashboard":
        return "app"
    if mode == "legacy" and style == "app":
        return "dashboard"
    if mode in ("app", "react") and style != "app":
        _warn_shell_ignored(style)
    return style


_shell_ignored_warned: set[str] = set()


def _warn_shell_ignored(style: str) -> None:
    """Say once per style that ``AIUI_SHELL=app`` did nothing.

    ``aiui run`` picks ``chat`` for an app with ``@aiui.reply``, and only the
    ``dashboard`` style is rewritten, so the shell (and plugin pages) never
    appeared and nothing said why.
    """
    if style in _shell_ignored_warned:
        return
    _shell_ignored_warned.add(style)
    logger.warning(
        "%s=app ignored: style is %r (only 'dashboard' is switched); use --style app",
        SHELL_ENV,
        style,
    )


_registry: Optional[PluginRegistry] = None
_registry_lock = threading.Lock()


def get_plugin_registry() -> PluginRegistry:
    global _registry
    with _registry_lock:
        if _registry is None:
            _registry = PluginRegistry()
        return _registry


def register_plugin(plugin: Any) -> None:
    """Register a plugin object in-process (no packaging needed).

    In-process plugins are trusted: their browser surfaces are served even
    when the server is remote or requires auth.
    """
    get_plugin_registry().register(plugin)


def set_extensions(
    *, enabled: Optional[list[str]] = None, disabled: Optional[list[str]] = None
) -> None:
    """Set the entry-point plugin policy from Python (beats YAML ``extensions:``).

    ``enabled=None`` loads every installed plugin; a list is a strict
    allowlist and also opts those plugins' browser surfaces in on remote or
    auth-enforced servers. ``disabled`` always wins and is never imported.
    """
    get_plugin_registry().set_policy(
        ExtensionPolicy(
            enabled=list(enabled) if enabled is not None else None,
            disabled=list(disabled or []),
        )
    )


__all__ = [
    "BUILTIN_PREFIX",
    "ENTRY_POINT_GROUP",
    "SDK_API_VERSION",
    "AiuiPlugin",
    "BlockSpec",
    "ExtensionPolicy",
    "LayoutSpec",
    "NavGroupSpec",
    "PageSpec",
    "PluginRecord",
    "PluginRegistry",
    "SettingsError",
    "SettingsField",
    "SettingsSectionSpec",
    "ThemeSpec",
    "ToolRendererSpec",
    "get_plugin_registry",
    "get_plugin_settings",
    "register_plugin",
    "resolve_shell_style",
    "sanitize_plugin_name",
    "set_extensions",
]
