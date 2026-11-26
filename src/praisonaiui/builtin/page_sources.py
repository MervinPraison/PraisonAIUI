"""One page list from every page source (gap G9).

Pages reach the host through several registration paths: the built-in
records, entry-point / ``register_plugin`` plugins, the legacy
``register_page`` / ``@aiui.page`` adapter and dashboard-plugin folders
(``manifest.json``). Each adapter here turns one legacy registration into
the same :class:`~praisonaiui.plugin_registry.PageSpec` record a plugin
contributes, tagged with its ``source``; :func:`merge_pages` then applies
the one precedence rule (app > built-in > plugin > folder, first wins).
``GET /api/pages`` and the shell manifest both read the merged list, so they
can no longer disagree about which page owns an id.

Each record also carries the two wire rows it is served as, built exactly
as before (the ``/api/pages`` key order is part of its format), so no
response changes. Visibility (``set_pages`` / ``pages.enabled`` /
``remove_page``) keeps acting on the page table before the merge.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

from praisonaiui.builtin.page_types import shell_row_fields
from praisonaiui.plugin_registry import PageSpec, resolve_page_badge

_log = logging.getLogger("praisonaiui.server")


@dataclass(frozen=True)
class PageRecord:
    """A page from any source.

    spec:      the plugin-record view (``source`` says where it came from).
    shell_row: its entry in the app shell manifest.
    api_row:   its entry in ``GET /api/pages`` (the legacy dashboard), or
               ``None`` when the dashboard cannot render it.
    """

    spec: PageSpec
    shell_row: dict[str, Any] = field(compare=False)
    api_row: Optional[dict[str, Any]] = field(default=None, compare=False)

    @property
    def id(self) -> str:
        return self.spec.id

    @property
    def source(self) -> str:
        return self.spec.source


def table_page(
    row: dict[str, Any],
    *,
    custom: bool,
    has_handler: bool,
    native: bool,
    has_action: bool,
    builtin_spec: Optional[PageSpec] = None,
    badge: Optional[str] = None,
) -> PageRecord:
    """A row of the host page table: a built-in page, or an app page from
    the ``register_page`` / ``@aiui.page`` adapter (``custom``)."""
    if custom:
        kind = "blocks" if has_handler else "legacy"
    else:
        kind = "native" if native else "legacy"
    entry: dict[str, Any] = {
        "id": row["id"],
        "title": row.get("title", row["id"]),
        "kind": kind,
        "icon": row.get("icon", "file"),
        "group": row.get("group", "Custom"),
        "order": row.get("order", 100),
        "description": row.get("description", ""),
        "apiEndpoint": row.get("api_endpoint"),
        "source": "app" if custom else "builtin",
    }
    for opt in ("layout", "position"):
        if row.get(opt):
            entry[opt] = row[opt]
    spec = None if custom else builtin_spec
    if spec is not None:
        if spec.nav_icon:
            entry["navIcon"] = spec.nav_icon
        if spec.shell_layout:
            entry["layout"] = spec.shell_layout
        entry.update(shell_row_fields(spec))
    resolved_badge = badge if badge is not None else (resolve_page_badge(spec.badge) if spec is not None else None)
    if resolved_badge:
        entry["badge"] = resolved_badge
    if has_action:
        entry["actionEndpoint"] = f"/api/pages/{row['id']}/action"
    record = spec or PageSpec(
        id=entry["id"],
        title=entry["title"],
        kind=kind,  # type: ignore[arg-type]
        icon=entry["icon"],
        group=entry["group"],
        order=entry["order"],
        description=entry["description"],
        api_endpoint=entry["apiEndpoint"],
        layout=row.get("layout"),
        position=row.get("position"),
        source=entry["source"],
    )
    return PageRecord(record, entry, row)


def plugin_page(spec: PageSpec) -> PageRecord:
    """A page an entry-point or ``register_plugin`` plugin contributes.

    The legacy dashboard renders only server-driven ``blocks`` pages, and
    never a ``shell_only`` one.
    """
    api_row = None
    if spec.kind == "blocks" and not spec.shell_only:
        api_row = {
            "id": spec.id,
            "title": spec.title,
            "icon": spec.icon,
            "group": spec.group,
            "description": spec.description,
            "api_endpoint": spec.api_endpoint,
            "order": spec.order,
        }
    return PageRecord(spec, spec.to_dict(), api_row)


def shell_page(spec: PageSpec) -> PageRecord:
    """A first-party ``shell_only`` page (ADR 0003): a shell manifest row in
    the page-table row format, and no ``/api/pages`` row."""
    entry: dict[str, Any] = {
        "id": spec.id,
        "title": spec.title,
        "kind": spec.kind,
        "icon": spec.icon,
        "group": spec.group,
        "order": spec.order,
        "description": spec.description,
        "source": spec.source,
    }
    if spec.api_endpoint:
        entry["apiEndpoint"] = spec.api_endpoint
    if spec.shell_layout or spec.layout:
        entry["layout"] = spec.shell_layout or spec.layout
    if spec.nav_icon:
        entry["navIcon"] = spec.nav_icon
    if spec.layouts:
        entry["layouts"] = list(spec.layouts)
    if spec.replaces:
        entry["replaces"] = spec.replaces
    resolved_badge = resolve_page_badge(spec.badge)
    if resolved_badge:
        entry["badge"] = resolved_badge
    entry.update(shell_row_fields(spec))
    return PageRecord(spec, entry, None)


def shell_pages(registry: Any, style: Optional[str], *, restricted: bool) -> list[PageRecord]:
    """The shell-only built-in pages for the layouts on offer (none outside
    ``style: app``). The layout choice is resolved only when a built-in
    declares such a page, so page navigation does not pay for it otherwise."""
    specs = registry.shell_pages(None)
    if not specs:
        return []
    from praisonaiui.layouts import resolve

    ids = set(resolve(registry, style, restricted=restricted).ids)
    if not ids:
        return []
    return [shell_page(s) for s in specs if not s.layouts or ids.intersection(s.layouts)]


def folder_page(manifest: dict[str, Any]) -> Optional[PageRecord]:
    """The page of a dashboard-plugin folder (``manifest.json`` adapter)."""
    page = manifest.get("page") or {}
    if not page or not page.get("id"):
        return None
    source = f"dashboard-plugin:{manifest['name']}"
    module = f"/dashboard-plugins/{manifest['name']}/{manifest['entry']}"
    css = f"/dashboard-plugins/{manifest['name']}/{manifest['css']}" if manifest.get("css") else None
    badge = resolve_page_badge(page.get("badge"))
    shell_row = {
        "order": 100,
        **page,
        "kind": "legacy",
        "module": module,
        **({"css": css} if css else {}),
        **({"badge": badge} if badge else {}),
        "source": source,
    }
    spec = PageSpec(
        id=page["id"],
        title=page.get("title", page["id"]),
        kind="legacy",
        icon=page.get("icon", "file"),
        group=page.get("group", "Plugins"),
        order=page.get("order", 100),
        description=page.get("description", ""),
        module=module,
        css=css,
        badge=badge,
        source=source,
    )
    return PageRecord(spec, shell_row, page)


def folder_pages(manifests: Iterable[dict[str, Any]]) -> list[PageRecord]:
    return [r for r in (folder_page(m) for m in manifests) if r is not None]


def merge_pages(records: Iterable[PageRecord], *, log_shadows: bool = False) -> list[PageRecord]:
    """First record per id wins; pass sources in precedence order
    (page table, plugins, folders). Sorted by (order, id) like the nav."""
    seen: dict[str, str] = {}
    out: list[PageRecord] = []
    for rec in records:
        owner = seen.get(rec.id)
        if owner is not None:
            if log_shadows and rec.source.startswith("plugin:"):
                _log.warning(
                    "plugin page %r (%s) is shadowed by an existing page (%s)",
                    rec.id, rec.source, owner,
                )
            elif log_shadows and owner != rec.source:
                _log.debug("dashboard-plugin page %r shadowed by %s", rec.id, owner)
            continue
        seen[rec.id] = rec.source
        out.append(rec)
    out.sort(key=lambda r: (r.shell_row.get("order", 100), r.id))
    return out


__all__ = [
    "PageRecord",
    "folder_page",
    "folder_pages",
    "merge_pages",
    "plugin_page",
    "shell_page",
    "shell_pages",
    "table_page",
]
