"""Declarative, dynamically-reloaded UI pages from YAML (``aiui run app.yaml``).

A YAML app's ``pages:`` list can mix:
- Built-in page id strings (e.g. ``chat``, ``sessions``) — forwarded to
  :func:`praisonaiui.set_pages` unchanged.
- Declarative page mappings (``{id, title, icon, group, description, order,
  badge, refresh_every, api_endpoint, components | blocks | markdown |
  markdown_file, toc}``) — registered as first-class server-driven BlockPages
  using the exact same :func:`praisonaiui.register_page` protocol as Python
  ``@aiui.page`` handlers.

When ``source_file`` is given, each page handler and dynamic badge checks the
file's ``mtime_ns`` and reloads updated YAML / ``markdown_file`` content on
demand so editing ``app.yaml`` updates blocks and sidebar badges live without
restarting the server.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Optional, Sequence

_log = logging.getLogger("praisonaiui.yaml_pages")


def _safe_relative_file(base_dir: Path, rel_path: str) -> Optional[Path]:
    """Resolve ``rel_path`` strictly inside ``base_dir`` (blocks ``../`` traversal)."""
    if not rel_path or not isinstance(rel_path, str):
        return None
    try:
        root = base_dir.resolve()
        candidate = (root / rel_path).resolve()
        if not candidate.is_relative_to(root):
            _log.warning("Refused markdown_file outside YAML directory: %r", rel_path)
            return None
        return candidate
    except (OSError, ValueError):
        return None


def _normalize_component(item: dict[str, Any]) -> dict[str, Any]:
    """Normalize YAML component ergonomics while leaving custom/plugin types untouched."""
    comp = dict(item)
    ctype = comp.get("type")

    # Recurse into nested children / tabs / accordion items first.
    if isinstance(comp.get("children"), list):
        comp["children"] = [
            _normalize_component(c) if isinstance(c, dict) else c for c in comp["children"]
        ]
    if ctype in ("tabs", "accordion") and isinstance(comp.get("items"), list):
        items = []
        for entry in comp["items"]:
            if isinstance(entry, dict) and isinstance(entry.get("children"), list):
                entry = {
                    **entry,
                    "children": [
                        _normalize_component(c) if isinstance(c, dict) else c
                        for c in entry["children"]
                    ],
                }
            items.append(entry)
        comp["items"] = items

    # Ergonomic YAML shorthands that match Python ui.* helpers.
    if ctype == "doc_viewer":
        from praisonaiui import ui

        return ui.doc_viewer(
            str(comp.get("content") or ""),
            title=comp.get("title"),
            toc=bool(comp.get("toc", True)),
        )
    if ctype == "page_link" and comp.get("page"):
        from praisonaiui import ui

        return ui.page_link(
            str(comp["page"]),
            str(comp.get("text") or comp.get("label") or comp["page"]),
            variant=comp.get("variant"),
            params=comp.get("params") if isinstance(comp.get("params"), dict) else None,
        )
    if ctype == "table" and isinstance(comp.get("rows"), list) and (
        any(isinstance(r, dict) for r in comp["rows"]) or ("columns" in comp and "headers" not in comp)
    ):
        from praisonaiui import ui

        kwargs = {k: v for k, v in comp.items() if k != "type"}
        try:
            return ui.table(**kwargs)
        except Exception as exc:
            _log.debug("YAML table normalization skipped (serving raw dict): %s", exc)
    return comp


def _page_components(spec: dict[str, Any], base_dir: Optional[Path]) -> list[dict[str, Any]]:
    """Build the ``_components`` list for one declarative YAML page dict."""
    raw = spec.get("components")
    if raw is None:
        raw = spec.get("blocks")
    components: list[dict[str, Any]] = [
        _normalize_component(item) for item in raw if isinstance(item, dict)
    ] if isinstance(raw, list) else []

    md_inline = spec.get("markdown")
    md_file = spec.get("markdown_file") or spec.get("markdownFile")
    toc = bool(spec.get("toc", bool(md_file)))
    doc_title = spec.get("doc_title") or spec.get("docTitle")

    if isinstance(md_file, str) and md_file.strip() and base_dir is not None:
        resolved = _safe_relative_file(base_dir, md_file.strip())
        if resolved is not None and resolved.is_file():
            try:
                text = resolved.read_text(encoding="utf-8")
                block: dict[str, Any] = {"type": "markdown_text", "content": text}
                if toc:
                    block["toc"] = True
                if doc_title:
                    block["title"] = str(doc_title)
                components.append(block)
            except OSError as exc:
                components.append({"type": "alert", "variant": "warning", "message": f"Could not read {md_file}: {exc}"})
        else:
            components.append({"type": "alert", "variant": "warning", "message": f"Markdown file not found: {md_file}"})
    elif isinstance(md_inline, str) and md_inline:
        block = {"type": "markdown_text", "content": md_inline}
        if toc:
            block["toc"] = True
        if doc_title:
            block["title"] = str(doc_title)
        components.append(block)

    return components


class _YamlPageStore:
    """Live, mtime-cached lookup for declarative page definitions in one YAML file.

    Uses :func:`praisonaiui.schema.loader.load_config_file` so ``$ref`` includes
    are resolved and tracked: editing either the root YAML or any included file
    refreshes page blocks and dynamic badges on the next request.
    """

    def __init__(self, initial: dict[str, dict[str, Any]], source_file: Optional[Path]) -> None:
        self._pages: dict[str, dict[str, Any]] = dict(initial)
        self._source_file = source_file.resolve() if source_file is not None else None
        self._watched: list[Path] = []
        self._mtimes: tuple[int, ...] = ()
        if self._source_file is not None:
            self._watched = self._discover_files(self._source_file)
            self._mtimes = self._snapshot_mtimes(self._watched)

    def _discover_files(self, root_file: Path) -> list[Path]:
        files = [root_file]
        try:
            from praisonaiui.schema.loader import load_config_file

            sources: dict[tuple, str] = {}
            load_config_file(root_file, sources=sources)
            seen = {root_file}
            for rel in sources.values():
                candidate = (root_file.parent / rel).resolve()
                if candidate not in seen:
                    seen.add(candidate)
                    files.append(candidate)
        except Exception:
            pass
        return files

    @staticmethod
    def _snapshot_mtimes(paths: Sequence[Path]) -> tuple[int, ...]:
        out: list[int] = []
        for p in paths:
            try:
                out.append(p.stat().st_mtime_ns)
            except OSError:
                out.append(-1)
        return tuple(out)

    def _maybe_reload(self) -> None:
        if self._source_file is None:
            return
        mtimes = self._snapshot_mtimes(self._watched)
        if mtimes == self._mtimes:
            return
        try:
            from praisonaiui.schema.loader import load_config_file

            sources: dict[tuple, str] = {}
            loaded = load_config_file(self._source_file, sources=sources) or {}
            raw_pages = loaded.get("pages") if isinstance(loaded, dict) else None
            if isinstance(raw_pages, list):
                updated: dict[str, dict[str, Any]] = {}
                for entry in raw_pages:
                    if isinstance(entry, dict) and entry.get("id"):
                        updated[str(entry["id"])] = entry
                if updated:
                    self._pages = updated
            watched = [self._source_file]
            seen = {self._source_file}
            for rel in sources.values():
                candidate = (self._source_file.parent / rel).resolve()
                if candidate not in seen:
                    seen.add(candidate)
                    watched.append(candidate)
            self._watched = watched
            self._mtimes = self._snapshot_mtimes(watched)
        except Exception as exc:
            _log.debug("Keeping last valid YAML pages after reload error: %s", exc)

    def get(self, page_id: str) -> Optional[dict[str, Any]]:
        self._maybe_reload()
        return self._pages.get(page_id)

    @property
    def base_dir(self) -> Optional[Path]:
        return self._source_file.parent if self._source_file is not None else None


def apply_yaml_pages(
    pages_cfg: Sequence[Any],
    *,
    source_file: Optional[Path] = None,
) -> list[str]:
    """Apply a YAML ``pages:`` list (built-in ids and/or declarative page dicts).

    Returns the ids of declarative pages registered.
    """
    from praisonaiui.server import register_page, set_pages

    builtin_ids: list[str] = []
    declarative: dict[str, dict[str, Any]] = {}

    for entry in pages_cfg:
        if isinstance(entry, str):
            item = entry.strip()
            if item:
                builtin_ids.append(item)
        elif isinstance(entry, dict) and entry.get("id"):
            declarative[str(entry["id"]).strip()] = entry

    # Preserve exact existing set_pages() behavior for string lists (and when
    # mixing built-in ids with custom YAML pages, keep only the named built-ins).
    if builtin_ids or not declarative:
        set_pages(builtin_ids)

    if not declarative:
        return []

    store = _YamlPageStore(declarative, source_file)
    registered: list[str] = []

    for page_id, spec in declarative.items():
        title = str(spec.get("title") or page_id)
        icon = str(spec.get("icon") or "📄")
        group = str(spec.get("group") or "Custom")
        description = str(spec.get("description") or "")
        order = int(spec.get("order", 100))
        refresh_every = spec.get("refresh_every", spec.get("refreshEvery"))
        api_endpoint = spec.get("api_endpoint") or spec.get("apiEndpoint")

        badge: Any = None
        if source_file is not None:
            def _make_badge(pid: str) -> Callable[[], Any]:
                def _badge() -> Any:
                    cur = store.get(pid)
                    return cur.get("badge") if cur else None
                return _badge

            badge = _make_badge(page_id)
        elif spec.get("badge") is not None:
            badge = spec.get("badge")

        handler: Optional[Callable[..., Any]] = None
        if not api_endpoint:
            def _make_handler(pid: str) -> Callable[..., dict[str, Any]]:
                def _handler() -> dict[str, Any]:
                    cur = store.get(pid) or {}
                    out: dict[str, Any] = {"_components": _page_components(cur, store.base_dir)}
                    ref = cur.get("refresh_every", cur.get("refreshEvery"))
                    if ref:
                        out["_refresh_every"] = ref
                    return out
                return _handler

            handler = _make_handler(page_id)

        register_page(
            page_id,
            title=title,
            icon=icon,
            group=group,
            description=description,
            api_endpoint=str(api_endpoint) if api_endpoint else None,
            handler=handler,
            order=order,
            refresh_every=float(refresh_every) if refresh_every is not None else None,
            badge=badge,
        )
        registered.append(page_id)

    return registered


__all__ = ["apply_yaml_pages"]
