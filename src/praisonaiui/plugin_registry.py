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
(pages, blocks, tool renderers and the static dir) are **default-deny** when
the server requires auth or is reached from a non-loopback address. In that
case they are listed with status ``disabled-by-default`` and only served for
plugins named explicitly in ``extensions.enabled`` / ``set_extensions(enabled=…)``.
Plugins registered in-process with :func:`register_plugin` were chosen by the
app author and are always trusted.

This module is distinct from :mod:`praisonaiui.plugins` (docs compiler hooks).
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import threading
from dataclasses import asdict, dataclass, field
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
    source: str = "builtin"

    def to_dict(self) -> dict[str, Any]:
        return _to_wire(self)


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


@runtime_checkable
class AiuiPlugin(Protocol):
    """Duck-typed plugin contract. Only ``name`` is required."""

    name: str

    # Optional members (checked with getattr):
    #   version: str
    #   sdk: int                                  -> required SDK major (default 1)
    #   def pages(self) -> Iterable[PageSpec | dict]
    #   def blocks(self) -> Iterable[BlockSpec]
    #   def tool_renderers(self) -> Iterable[ToolRendererSpec]
    #   def routes(self) -> list[starlette.routing.BaseRoute]   (mounted /api/plugins/<name>)
    #   def static_dir(self) -> Path | None                     (served /_plugins/<name>/)
    #   def features(self) -> Iterable[BaseFeatureProtocol]
    #   def cli_commands(self) -> typer.Typer | None
    #   def setup(self, ctx: dict) -> None                      (called once per create_app)


@dataclass
class PluginRecord:
    name: str
    entry_point: str
    dist: Optional[str] = None
    version: Optional[str] = None
    status: PluginStatus = "ok"
    error: Optional[str] = None
    plugin: Any = field(default=None, repr=False)
    #: True for entry-point plugins (autoloaded), False for register_plugin().
    autoloaded: bool = True

    def to_dict(self, *, status: Optional[str] = None, include_error: bool = True) -> dict[str, Any]:
        d: dict[str, Any] = {
            "name": self.name,
            "entryPoint": self.entry_point,
            "dist": self.dist,
            "version": self.version,
            "status": status or self.status,
        }
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
        self.policy = ExtensionPolicy()
        self._explicit = False

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
            self.policy = ExtensionPolicy()
            self._explicit = False

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
            out.append(rec.to_dict(status=status, include_error=include_errors))
        return out

    # contributions -----------------------------------------------------
    def pages(self, *, restricted: bool = False) -> list[PageSpec]:
        return self._collect("pages", _resolve_page, restricted)

    def blocks(self, *, restricted: bool = False) -> list[BlockSpec]:
        return self._collect("blocks", _resolve_asset, restricted)

    def tool_renderers(self, *, restricted: bool = False) -> list[ToolRendererSpec]:
        return self._collect("tool_renderers", _resolve_asset, restricted)

    def _collect(self, hook: str, resolve: Callable[[PluginRecord, Any], Any], restricted: bool) -> list:
        out: list = []
        for rec in self.js_active(restricted=restricted):
            fn = getattr(rec.plugin, hook, None)
            if not callable(fn):
                continue
            try:
                for spec in fn() or ():
                    out.append(resolve(rec, spec))
            except Exception as exc:  # noqa: BLE001
                logger.warning("aiui plugin %s.%s() failed: %s", rec.name, hook, exc)
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
        from starlette.routing import Mount
        from starlette.staticfiles import StaticFiles

        mounts: list = []
        for rec in self.active():
            fn = getattr(rec.plugin, "routes", None)
            if callable(fn):
                try:
                    sub = list(fn() or [])
                    if sub:
                        mounts.append(Mount(f"/api/plugins/{rec.name}", routes=sub))
                except Exception as exc:  # noqa: BLE001
                    logger.warning("aiui plugin %s.routes() failed: %s", rec.name, exc)
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
    """ASGI wrapper: serve a plugin's static dir only when its JS is allowed."""

    def __init__(self, registry: PluginRegistry, rec: PluginRecord, app: Any,
                 is_restricted: Optional[Callable[[dict], bool]]) -> None:
        self.registry = registry
        self.rec = rec
        self.app = app
        self.is_restricted = is_restricted

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            return
        restricted = True
        try:
            restricted = bool(self.is_restricted(scope)) if self.is_restricted else False
        except Exception:  # noqa: BLE001 - fail closed
            restricted = True
        if not self.registry.js_allowed(self.rec, restricted=restricted):
            from starlette.responses import PlainTextResponse

            await PlainTextResponse("Not Found", status_code=404)(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _instantiate(obj: Any) -> Any:
    if isinstance(obj, type):
        return obj()
    if callable(obj) and not hasattr(obj, "name"):
        return obj()  # factory
    return obj


def _sri(path: Path) -> Optional[str]:
    try:
        digest = hashlib.sha384(path.read_bytes()).digest()
    except OSError:
        return None
    return "sha384-" + base64.b64encode(digest).decode()


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


def _resolve_page(rec: PluginRecord, spec: Any) -> PageSpec:
    if isinstance(spec, dict):
        spec = PageSpec(**spec)
    module, sri = _asset_url(rec, spec.module)
    css, _ = _asset_url(rec, spec.css)
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
            "source": f"plugin:{rec.name}",
        }
    )


def _resolve_asset(rec: PluginRecord, spec: Any):
    module, sri = _asset_url(rec, spec.module)
    return type(spec)(
        **{
            **asdict(spec),
            "module": module,
            "integrity": spec.integrity or sri,
            "source": f"plugin:{rec.name}",
        }
    )


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
    return style


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
    "ENTRY_POINT_GROUP",
    "SDK_API_VERSION",
    "AiuiPlugin",
    "BlockSpec",
    "ExtensionPolicy",
    "PageSpec",
    "PluginRecord",
    "PluginRegistry",
    "ToolRendererSpec",
    "get_plugin_registry",
    "register_plugin",
    "resolve_shell_style",
    "sanitize_plugin_name",
    "set_extensions",
]
