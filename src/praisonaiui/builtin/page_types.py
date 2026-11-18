"""Page templates: which PraisonAI Pro template each built-in page uses.

The app shell (``style: app``) dresses a page by its template, never by its
id (ARCHITECTURE R1). The template travels as data: the shell manifest row
carries ``pageType``, the shell puts it on the page root as
``data-aiui-page-type``, and ``src/frontend/src/legacy/page-types.css`` styles
legacy views per template. React pages and blocks use the matching
components in ``src/frontend/src/components/page/``.

The templates follow the Pro page designs (``ProList``, ``ProBoard``,
``ProLogs``, ``ProEditor``, ``ProGallery``, ``ProOverview``, ``ProSettings``);
DESIGN.md "Page templates" describes each one.

This table is the one place a built-in page gets its template, so
``catalog.py`` does not change: :func:`apply_page_type` fills ``page_type``
on a first-party ``PageSpec`` that does not declare one. A plugin page may
declare its own ``page_type``; the shell styles the templates in
:data:`PAGE_TYPES` and leaves any other value alone. The legacy dashboard
(``style: dashboard``) never reads it, so its output does not change (R6).
"""

from __future__ import annotations

import re
from dataclasses import fields, is_dataclass, replace
from types import MappingProxyType
from typing import Any, Mapping, Optional, TypeVar

#: Same shape as a layout id: lower case, digits and ``-``, at most 40.
PAGE_TYPE_ID = re.compile(r"^[a-z][a-z0-9-]{0,39}$")

#: The templates the app shell styles, in DESIGN.md order.
#:
#: - ``chat``: the chat engine owns the page (the shell adds nothing).
#: - ``overview``: a measure-wide dashboard (greeting, KPI strip, cards).
#: - ``list``: list + detail (toolbar, dense table, detail panel, pagination).
#: - ``board``: columns of cards (kanban, job stages).
#: - ``log``: a time-ordered, monospaced event stream with level filters.
#: - ``editor``: a full-height workspace (files, tabs, code, terminal).
#: - ``gallery``: a card grid to browse and install from.
#: - ``settings``: a sectioned form at a readable measure.
PAGE_TYPES: tuple[str, ...] = (
    "chat",
    "overview",
    "list",
    "board",
    "log",
    "editor",
    "gallery",
    "settings",
)

#: The template of every built-in page, by page id. Shell-only layout pages
#: (ADR 0003: ``start``, ``templates``, ``ops-overview``, ``artifacts``) are
#: listed ahead of the tracks that ship them, so they arrive styled.
PAGE_TYPE_BY_ID: Mapping[str, str] = MappingProxyType(
    {
        # chat: the chat engine and the A2UI surfaces
        "chat": "chat",
        "chat-canvas": "chat",
        "canvas": "chat",
        # overview: status at a glance
        "overview": "overview",
        "ops-overview": "overview",
        "start": "overview",
        "usage": "overview",
        "telemetry": "overview",
        "security": "overview",
        # list + detail (ProList: "Runs, Agents, Skills, Memory, Knowledge
        # sources, Approvals, Jobs, Schedules, Channels, MCP servers, Nodes,
        # Guardrails, Feedback, Eval, Training and Replay")
        "sessions": "list",
        "runs": "list",
        "replay": "list",
        "agents": "list",
        "skills": "list",
        "memory": "list",
        "knowledge": "list",
        "approvals": "list",
        "jobs": "list",
        "cron": "list",
        "channels": "list",
        "inbox": "list",
        "mcp": "list",
        "nodes": "list",
        "guardrails": "list",
        "feedback": "list",
        "eval": "list",
        "training": "list",
        "inspector": "list",
        "api": "list",
        "artifacts": "list",
        # board (ProBoard: "Jobs, Work Hub, Workflows, Approvals by stage")
        "kanban": "board",
        "jobs-board": "board",
        "work": "board",
        # log viewer
        "logs": "log",
        "debug": "log",
        "traces": "log",
        # editor
        "code-studio": "editor",
        # gallery (ProGallery: "Skills, Examples, Templates, Themes, MCP
        # server directory and Knowledge connectors")
        "marketplace": "gallery",
        "theme-picker": "gallery",
        "templates": "gallery",
        # settings: sectioned forms (config also has a YAML mode, which the
        # settings template gives the editor's code surface)
        "config": "settings",
        "auth": "settings",
        # Connect: per-client setup at a readable measure, beside a client rail
        "connect": "settings",
        # API Reference: a route rail beside one route's form (the same shape)
        "api-reference": "settings",
    }
)

_S = TypeVar("_S")


def validate_page_type(value: Any) -> Optional[str]:
    """``value`` if it is a valid page type (or ``None``); else ``ValueError``."""
    if value is None:
        return None
    if not isinstance(value, str) or not PAGE_TYPE_ID.match(value):
        raise ValueError(
            f"invalid page type {value!r} (a-z, 0-9 and -, starting with a letter, "
            "at most 40 characters)"
        )
    return value


def page_type_for(page_id: str) -> Optional[str]:
    """The template of the built-in page ``page_id``, or ``None``."""
    return PAGE_TYPE_BY_ID.get(page_id)


def _has_page_type_field(spec: Any) -> bool:
    return is_dataclass(spec) and any(f.name == "page_type" for f in fields(spec))


def apply_page_type(spec: _S) -> _S:
    """A first-party page spec with its template filled in.

    A spec that already declares a ``page_type`` keeps it (validated); a
    page this table does not list, or a spec type without the field, is
    returned unchanged.
    """
    if not _has_page_type_field(spec):
        return spec
    declared = validate_page_type(getattr(spec, "page_type"))
    if declared is not None:
        return spec
    found = page_type_for(getattr(spec, "id"))
    return spec if found is None else replace(spec, page_type=found)  # type: ignore[type-var]


def shell_row_fields(spec: Any) -> dict[str, str]:
    """The shell manifest field for a page spec: ``{"pageType": ...}`` or ``{}``.

    For the page-table rows the host builds by hand
    (``builtin/page_sources.py``); plugin rows get it from ``to_dict()``.
    """
    value = getattr(spec, "page_type", None) or page_type_for(getattr(spec, "id", ""))
    return {"pageType": value} if value else {}


__all__ = [
    "PAGE_TYPES",
    "PAGE_TYPE_BY_ID",
    "PAGE_TYPE_ID",
    "apply_page_type",
    "page_type_for",
    "shell_row_fields",
    "validate_page_type",
]
