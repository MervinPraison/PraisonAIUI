"""Selectable layouts (ADR 0003): which app shell frames the server offers.

A layout is a frame around the routed page (navigation, session list, side
panels). Plugins declare layouts with the ``layouts()`` hook; the
first-party ones are the ``builtin.layout-<id>`` records in
:mod:`praisonaiui.builtin.catalog`. This module holds the app's choice and
turns it into the shell manifest's ``layouts`` key::

    style: app
    layout: command                      # shorthand for {default: command}
    layout: {default: command, available: [command, chat-canvas], user_choice: true}

    aiui.set_layout("command", available=["command", "chat-canvas"])

The server default is resolved in this order: ``AIUI_LAYOUT`` (an id or
``classic``), then :func:`set_layout`, then YAML ``layout:``, then the style
default (``chat-canvas`` for ``style: app``). ``classic`` means the shell's
own frame. Layouts apply to ``style: app`` only: anywhere else they are
ignored with one warning, and the style is never changed.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import threading
from dataclasses import dataclass
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

LAYOUT_ENV = "AIUI_LAYOUT"
#: The core's own frame. A valid choice for ``default``, never a layout.
CLASSIC = "classic"
#: Same rule as the browser (``LAYOUT_ID_PATTERN``) and ``plugin_registry.LAYOUT_ID``.
LAYOUT_ID_PATTERN = r"^[a-z][a-z0-9-]{0,39}$"
_LAYOUT_ID = re.compile(LAYOUT_ID_PATTERN)
#: The only style that draws layouts.
LAYOUT_STYLE = "app"

_lock = threading.Lock()
_code: dict[str, Any] = {}  # what set_layout() was given (only the keys passed)
_warned: set[str] = set()


def check_layout_id(value: Any, *, allow_classic: bool = False, what: str = "layout id") -> str:
    """Return ``value`` if it is a layout id (``classic`` only when allowed)."""
    if not isinstance(value, str) or not _LAYOUT_ID.match(value):
        raise ValueError(
            f"invalid {what} {value!r}: use a-z, 0-9 and -, starting with a letter, at most 40 characters"
        )
    if value == CLASSIC and not allow_classic:
        raise ValueError(f"{what} {CLASSIC!r} is reserved for the shell's own frame")
    return value


def _id_list(value: Any, what: str) -> list[str]:
    """``value`` as a list; a bare string is refused (it would iterate per character)."""
    if isinstance(value, (str, bytes, dict)) or not isinstance(value, Iterable):
        raise ValueError(f"{what} must be a list of ids")
    return list(value)


def _page_ids(value: Any) -> list[str]:
    out = _id_list(value, "primary")
    for v in out:
        if not isinstance(v, str) or not v:
            raise ValueError(f"primary: invalid page id {v!r}")
    return out


def _options(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        raise ValueError("options must map layout ids to dicts")
    out: dict[str, dict[str, Any]] = {}
    for k, v in value.items():
        check_layout_id(k, what="options key")
        if not isinstance(v, dict):
            raise ValueError(f"options.{k} must be a dict")
        out[k] = dict(v)
    return out


def set_layout(
    default: Optional[str] = None,
    *,
    available: Optional[Iterable[str]] = None,
    user_choice: Optional[bool] = None,
    primary: Optional[Iterable[str]] = None,
    options: Optional[dict[str, dict[str, Any]]] = None,
) -> None:
    """Choose the app shell layouts from Python (beats YAML ``layout:``).

    default:     the layout a viewer starts with (``"classic"`` = the shell's
                 own frame). ``AIUI_LAYOUT`` still wins.
    available:   the layouts offered, in picker order (default: every layout
                 the enabled plugins declare).
    user_choice: whether a viewer's own pick (kept in their browser) may
                 override ``default`` (default ``True``).
    primary:     page ids for every layout's primary nav, in order.
    options:     per-layout settings, e.g. ``{"mission": {"dailyBudget": 10}}``.

    Only the arguments passed change; call it before the server starts.
    Applies to ``style: app`` only (see :mod:`praisonaiui.layouts`).
    """
    update: dict[str, Any] = {}
    if default is not None:
        update["default"] = check_layout_id(default, allow_classic=True, what="default layout")
    if available is not None:
        update["available"] = [
            check_layout_id(v, what="available layout") for v in _id_list(available, "available")
        ]
    if user_choice is not None:
        update["user_choice"] = bool(user_choice)
    if primary is not None:
        update["primary"] = _page_ids(primary)
    if options is not None:
        update["options"] = _options(options)
    with _lock:
        _code.update(update)


def reset() -> None:
    """Forget :func:`set_layout` and the warnings already logged (tests)."""
    with _lock:
        _code.clear()
        _warned.clear()


def _warn_once(key: str, msg: str, *args: Any) -> None:
    with _lock:
        if key in _warned:
            return
        _warned.add(key)
    logger.warning(msg, *args)


# ── configuration sources ────────────────────────────────────────────


def _host() -> Any:
    """The server module, if this process loaded it (no import here)."""
    return sys.modules.get("praisonaiui.server")


def _host_style() -> Optional[str]:
    return getattr(_host(), "_effective_style", None)


def _yaml_section() -> Any:
    """YAML ``layout:``: the ``create_app`` config first, then the config store."""
    cfg = getattr(_host(), "_config_cache", None)
    if isinstance(cfg, dict) and cfg.get("layout") is not None:
        return cfg["layout"]
    try:
        from praisonaiui.config_store import get_config_store

        cs = get_config_store()
        return cs.get_section("layout") if cs else None
    except Exception:  # noqa: BLE001 - an unreadable store means no YAML layout
        return None


#: The layout-selection keys of YAML ``layout:`` and their checks.
_SELECTION_CHECKS = (
    ("default", lambda v: check_layout_id(v, allow_classic=True, what="default layout")),
    ("available", lambda v: [check_layout_id(x, what="available layout") for x in _id_list(v, "available")]),
    ("primary", _page_ids),
    ("options", _options),
)


def split_selection(raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """``(valid, rejected)`` for the selection keys of a YAML ``layout:``
    mapping: a bad entry is moved to ``rejected`` (key → reason) and never
    fails the config. The server drops it with a warning, and ``aiui
    validate`` reports it (5103), so both read the same rules."""
    valid: dict[str, Any] = {}
    rejected: dict[str, str] = {}
    for key, check in _SELECTION_CHECKS:
        if raw.get(key) is None:
            continue
        try:
            valid[key] = check(raw[key])
        except ValueError as exc:
            rejected[key] = str(exc)
    return valid, rejected


def _yaml_selection() -> dict[str, Any]:
    """The layout keys of YAML ``layout:``. A bad entry is dropped with a warning."""
    raw = _yaml_section()
    if isinstance(raw, str):
        raw = {"default": raw}
    if not isinstance(raw, dict):
        return {}
    out, rejected = split_selection(raw)
    for key, reason in rejected.items():
        _warn_once(f"yaml:{key}:{raw[key]!r}", "YAML layout.%s ignored: %s", key, reason)
    choice = raw.get("user_choice", raw.get("userChoice"))
    if isinstance(choice, bool):
        out["user_choice"] = choice
    return out


def _env_default() -> Optional[str]:
    raw = os.environ.get(LAYOUT_ENV, "").strip()
    if not raw:
        return None
    try:
        return check_layout_id(raw, allow_classic=True, what=LAYOUT_ENV)
    except ValueError as exc:
        _warn_once(f"env:{raw}", "%s ignored: %s", LAYOUT_ENV, exc)
        return None


def _style_default(style: str) -> Optional[str]:
    from praisonaiui.builtin.catalog import STYLE_DEFAULT_LAYOUT

    return STYLE_DEFAULT_LAYOUT.get(style)


# ── resolution ───────────────────────────────────────────────────────


@dataclass(frozen=True)
class LayoutSelection:
    """What the server offers. ``default`` is ``""`` for the classic frame."""

    default: str
    user_choice: bool
    available: tuple[Any, ...]  # LayoutSpec, in picker order
    primary: Optional[tuple[str, ...]] = None
    options: Optional[dict[str, dict[str, Any]]] = None

    @property
    def ids(self) -> list[str]:
        return [s.id for s in self.available]


_NONE = LayoutSelection(default="", user_choice=True, available=())


def resolve(
    registry: Any = None,
    style: Optional[str] = None,
    *,
    restricted: bool = False,
    builtins: Optional[list] = None,
) -> LayoutSelection:
    """The layouts on offer and the default, after every override.

    ``style`` defaults to the running server's effective style. Outside
    ``style: app`` nothing is offered. Unknown ids in ``available`` or
    ``default`` are dropped with one warning; the default then falls back to
    the first available layout (or classic when none is).
    """
    style = _host_style() if style is None else style
    if style is None:  # no server in this process: nothing draws a layout
        return _NONE
    env = _env_default()
    with _lock:
        code = dict(_code)
    yaml = _yaml_selection()
    chosen = {**yaml, **code}
    if env is not None:
        chosen["default"] = env
    if style != LAYOUT_STYLE:
        if "default" in chosen or "available" in chosen:
            _warn_once(f"style:{style}", "layout ignored: style is %r; use style: app", style)
        return _NONE
    if registry is None:
        from praisonaiui.plugin_registry import get_plugin_registry

        registry = get_plugin_registry()
    known = registry.layout_specs(restricted=restricted, builtins=builtins)
    by_id = {s.id: s for s in known}
    available: list[Any]
    if "available" in chosen:
        available = []
        for lid in chosen["available"]:
            if lid in by_id and by_id[lid] not in available:
                available.append(by_id[lid])
            elif lid not in by_id:
                _warn_once(f"available:{lid}", "layout %r is not available: no enabled plugin declares it", lid)
    else:
        available = sorted(known, key=lambda s: s.order)  # stable: declaration order breaks ties
    ids = [s.id for s in available]
    style_default = _style_default(style)
    fallback = style_default if style_default in ids else (ids[0] if ids else "")
    default = chosen.get("default", fallback)
    if default == CLASSIC:
        default = ""
    elif default not in ids and default != fallback:
        _warn_once(
            f"default:{default}",
            "default layout %r is not available; using %r",
            default,
            fallback or CLASSIC,
        )
        default = fallback
    primary = chosen.get("primary")
    return LayoutSelection(
        default=default,
        user_choice=chosen.get("user_choice", True),
        available=tuple(available),
        primary=tuple(primary) if primary is not None else None,
        options=chosen.get("options"),
    )


def available_layout_ids(
    registry: Any = None, *, style: Optional[str] = None, builtins: Optional[list] = None
) -> set[str]:
    """Ids of the layouts on offer (no request context: plugin layouts count
    whatever the viewer). Used to gate built-ins with ``for_layouts``."""
    return set(resolve(registry, style, builtins=builtins).ids)


def default_layout(style: Optional[str] = None, *, restricted: bool = True) -> str:
    """The server's default layout id ('' = classic), for the first paint.

    ``_build_html`` marks ``<html data-aiui-tokens="pro">`` when it is a
    layout, so the page paints with the Pro tokens before the shell boots
    (the shell's layout host then keeps or clears the attribute). Never
    raises: a broken selection paints classic.
    """
    try:
        return resolve(None, style, restricted=restricted).default
    except Exception:  # noqa: BLE001 - first paint only; the manifest reports it
        return ""


def layouts_manifest(registry: Any = None, style: Optional[str] = None, *, restricted: bool = True) -> dict[str, Any]:
    """The shell manifest's ``layouts`` key (``ShellLayouts`` in sdk/manifest.ts)."""
    sel = resolve(registry, style, restricted=restricted)
    options = sel.options or {}
    available = []
    for spec in sel.available:
        d = spec.to_dict()
        if sel.primary is not None:
            d["primary"] = list(sel.primary)
        if spec.id in options:
            d["options"] = options[spec.id]
        available.append(d)
    return {"default": sel.default, "userChoice": sel.user_choice, "available": available}


__all__ = [
    "CLASSIC",
    "LAYOUT_ENV",
    "LAYOUT_ID_PATTERN",
    "LayoutSelection",
    "available_layout_ids",
    "check_layout_id",
    "default_layout",
    "layouts_manifest",
    "reset",
    "resolve",
    "set_layout",
    "split_selection",
]
