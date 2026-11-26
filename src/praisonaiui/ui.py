"""Component API for building dashboard UIs from Python.

These functions return structured dicts that the dashboard.js plugin
renders as real UI components. Users never write HTML/CSS/JS.

Usage in page handlers::

    @aiui.page("analytics", title="Analytics", icon="📊")
    async def analytics():
        return aiui.layout([
            aiui.columns([
                aiui.card("Total Users", value=42, footer="+12% this week"),
                aiui.card("Revenue", value="$1,500", footer="+8% this month"),
                aiui.card("Active Now", value=7),
            ]),
            aiui.table(
                headers=["Agent", "Tasks", "Status"],
                rows=[["Researcher", 15, "Active"], ["Writer", 8, "Idle"]],
            ),
        ])
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence


def _auto(comp: dict[str, Any], auto_submit: bool) -> dict[str, Any]:
    """Mark an input that submits its form on change (only when asked)."""
    if auto_submit:
        comp["auto_submit"] = True
    return comp


def layout(
    children: Sequence[dict],
    *,
    refresh_every: float | None = None,
    params: dict[str, Any] | None = None,
    badges: Mapping[str, Any] | None = None,
    refresh_manifest: bool = False,
    notifications: Sequence[Mapping[str, Any]] | None = None,
) -> dict:
    """Wrap components in a layout container.

    The returned dict is served as JSON by the page handler.
    The dashboard.js plugin detects the ``_components`` key
    and renders each child component.

    Args:
        children: List of component dicts (from card(), columns(), etc.)
        refresh_every: App shell: re-fetch the page every N seconds while it
            is visible (``_refresh_every``).
        params: In a page-action reply, the values the app shell writes into
            the page URL's query string (``_params``; ``None`` or ``""``
            removes a key), so a refresh or a shared link restores the view.
        badges: App shell: live sidebar badge updates ``{page_id: value}``
            (``None`` or ``""`` clears a page's badge) without reloading.
        refresh_manifest: App shell: re-fetch ``/api/shell/manifest`` in the
            background so dynamic server-computed badges/pages stay current.
        notifications: App shell: notification items pushed into the header
            Notification Center (``_notifications``).
    """
    out: dict[str, Any] = {"_components": list(children)}
    if refresh_every:
        out["_refresh_every"] = refresh_every
    if params is not None:
        out["_params"] = dict(params)
    if badges is not None:
        out["_badges"] = dict(badges)
    if refresh_manifest:
        out["_refresh_manifest"] = True
    if notifications:
        out["_notifications"] = [dict(item) for item in notifications]
    return out


def card(
    title: str,
    *,
    value: Any = None,
    footer: str | None = None,
) -> dict:
    """A metric/stat card.

    Args:
        title: Card header (e.g. "Total Users")
        value: Main value (number, string, etc.)
        footer: Small text below the value
    """
    comp: dict[str, Any] = {"type": "card", "title": title}
    if value is not None:
        comp["value"] = value
    if footer:
        comp["footer"] = footer
    return comp


def columns(children: Sequence[dict]) -> dict:
    """Arrange children in a responsive grid.

    Args:
        children: List of component dicts to lay out side-by-side
    """
    return {"type": "columns", "children": list(children)}


def board(*, columns: Sequence[dict]) -> dict:
    """Kanban-style board: horizontal columns of cards.

    Each column dict should include ``id``, ``title``, and ``cards``
    (list of card-shaped dicts or ``card()`` results).

    Example::

        aiui.board(columns=[
            {"id": "todo", "title": "Todo", "cards": [
                aiui.card("Task", footer="agent-a"),
            ]},
        ])
    """
    return {"type": "board", "columns": list(columns)}


CHART_KINDS = ("bar", "barh", "line", "area", "scatter", "pie", "donut", "histogram", "heatmap", "sparkline")
CHART_FORMATS = ("number", "compact", "percent", "multiplier", "duration")
CHART_SCALES = ("linear", "log")
CHART_FACET_SCALES = ("shared", "free")


def _chart_domain(name: str, domain: Sequence[Any]) -> list[float]:
    if not isinstance(domain, (list, tuple)) or len(domain) != 2:
        raise ValueError(f"{name} must be a 2-element [min, max] sequence")
    out: list[float] = []
    for v in domain:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ValueError(f"{name} bounds must be numbers")
        out.append(v)
    return out


def _chart_tooltip(tooltip: Sequence[str | Mapping[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in tooltip:
        if isinstance(item, str):
            if item:
                out.append({"key": item})
            continue
        if not isinstance(item, Mapping) or not item.get("key"):
            raise ValueError("chart tooltip items must be field keys or {'key': ...} dicts")
        entry: dict[str, Any] = {"key": str(item["key"])}
        if item.get("label"):
            entry["label"] = str(item["label"])
        if item.get("format") is not None:
            fmt = str(item["format"])
            if fmt not in CHART_FORMATS:
                raise ValueError(f"tooltip format must be one of {', '.join(CHART_FORMATS)}")
            entry["format"] = fmt
        out.append(entry)
    return out


def _chart_clip(clip: Any) -> Any:
    if isinstance(clip, bool):
        return True if clip else None
    if isinstance(clip, (int, float)):
        return [None, clip]
    if isinstance(clip, (list, tuple)) and len(clip) == 2:
        out: list[Any] = []
        for v in clip:
            if v is None:
                out.append(None)
            elif isinstance(v, (int, float)) and not isinstance(v, bool):
                out.append(v)
            else:
                raise ValueError("chart clip bounds must be numbers or None")
        if out[0] is None and out[1] is None:
            return None
        return out
    raise ValueError("chart clip must be a bool, a max number, or a [min, max] pair")


def _chart_reference(reference: Any) -> list[dict]:
    """A value, a list of values or a list of ``{value, label}`` → a list of dicts."""
    def is_num(v: Any) -> bool:
        return isinstance(v, (int, float)) and not isinstance(v, bool)

    items = reference if isinstance(reference, (list, tuple)) else [reference]
    out = [
        {k: i[k] for k in ("value", "label") if k in i} if isinstance(i, dict) else {"value": i}
        for i in items
        if is_num(i.get("value") if isinstance(i, dict) else i)
    ]
    if not out:
        raise ValueError("chart reference must be a number, a list of numbers or a list of {value, label}")
    return out


def chart(
    title: str = "",
    *,
    data: Sequence[Any] | None = None,
    chart_type: str = "bar",
    x: str | None = None,
    y: str | Sequence[str] | None = None,
    y2: str | None = None,
    labels: dict[str, str] | None = None,
    label: str | None = None,
    stacked: bool = False,
    reference: Any = None,
    color_by_reference: bool = False,
    x_format: str | None = None,
    y_format: str | None = None,
    x_domain: Sequence[float] | None = None,
    y_domain: Sequence[float] | None = None,
    x_scale: str | None = None,
    y_scale: str | None = None,
    tooltip: Sequence[str | Mapping[str, Any]] | None = None,
    clip: bool | int | float | Sequence[int | float | None] | None = None,
    bins: int | None = None,
    height: int | None = None,
    caption: str | None = None,
    legend: bool | None = None,
    value: str | None = None,
    facet: str | None = None,
    facet_scales: str | None = None,
    kind: str | None = None,
) -> dict:
    """A chart drawn in the browser (tooltips, theme colours, responsive width).

    Args:
        data: Rows as dicts (a histogram also takes plain numbers).
        chart_type: One of ``CHART_KINDS``; ``bar`` is columns, ``barh`` horizontal bars.
        x: Category key (scatter: x value; histogram: measured value). Default: first text column.
        y: Series key or keys. Default: every numeric column.
        y2: Secondary series drawn as faint bars on its own scale (bar, barh, line, area).
        labels: Display names for keys. label: key naming each scatter point.
        stacked: Stack the series (bar, barh, area).
        reference: A value, values or ``{value, label}`` dicts drawn as dashed lines.
        color_by_reference: Bars below the first reference are muted.
        x_format / y_format: One of ``CHART_FORMATS`` (k/M, %, x, seconds → 1:05).
        x_domain / y_domain: ``[min, max]`` bounds of the x / value axis (scatter, barh, histogram, etc.).
        x_scale / y_scale: ``"linear"`` (default) or ``"log"`` (non-positive values are omitted).
        tooltip: Extra row keys (or ``{"key", "label", "format"}`` dicts) shown in the tooltip.
        clip: Clamp outliers to ``x_domain``/``y_domain`` (``True``), to an upper cap (number), or ``[min, max]``.
        bins: Histogram bin count (default: Sturges' rule, at most 30).
        height: Plot height in px. caption: muted line under the chart.
        legend: Show the legend (default: more than one series).
        value: Heatmap cell value key (default ``value``); ``x`` is the column key and
            ``y`` the row key (defaults ``x`` and ``y``).
        facet: Key whose values split the rows into small charts.
        facet_scales: ``"shared"`` (default, one value scale) or ``"free"`` (each panel fits its own data).
        kind: Alias of ``chart_type``.
        See docs/api/components.md for examples.
    """
    if kind is not None:
        chart_type = kind
    if chart_type not in CHART_KINDS:
        raise ValueError(f"chart_type must be one of {', '.join(CHART_KINDS)}")
    for name, fmt in (("x_format", x_format), ("y_format", y_format)):
        if fmt is not None and fmt not in CHART_FORMATS:
            raise ValueError(f"{name} must be one of {', '.join(CHART_FORMATS)}")
    for name, sc in (("x_scale", x_scale), ("y_scale", y_scale)):
        if sc is not None and sc not in CHART_SCALES:
            raise ValueError(f"{name} must be one of {', '.join(CHART_SCALES)}")
    if facet_scales is not None and facet_scales not in CHART_FACET_SCALES:
        raise ValueError(f"facet_scales must be one of {', '.join(CHART_FACET_SCALES)}")
    rows = list(data or [])
    if chart_type in ("histogram", "sparkline") and rows and not isinstance(rows[0], dict):
        rows = [{"value": v} for v in rows]
        x = x or "value"
    comp: dict[str, Any] = {"type": "chart", "title": title, "data": rows, "chart_type": chart_type}
    # Only options that were given: a plain chart keeps the original dict shape.
    opts = {
        "x": x,
        "y": None if y is None else [y] if isinstance(y, str) else list(y),
        "y2": y2,
        "labels": dict(labels) if labels else None,
        "label": label,
        "stacked": True if stacked else None,
        "reference": None if reference is None else _chart_reference(reference),
        "color_by_reference": True if color_by_reference else None,
        "x_format": x_format,
        "y_format": y_format,
        "x_domain": None if x_domain is None else _chart_domain("x_domain", x_domain),
        "y_domain": None if y_domain is None else _chart_domain("y_domain", y_domain),
        "x_scale": x_scale if x_scale and x_scale != "linear" else None,
        "y_scale": y_scale if y_scale and y_scale != "linear" else None,
        "tooltip": _chart_tooltip(tooltip) if tooltip else None,
        "clip": None if clip is None else _chart_clip(clip),
        "bins": None if bins is None else int(bins),
        "height": None if height is None else int(height),
        "caption": caption or None,
        "legend": None if legend is None else bool(legend),
        "value": value,
        "facet": facet,
        "facet_scales": facet_scales if facet_scales and facet_scales != "shared" else None,
    }
    comp.update({k: v for k, v in opts.items() if v is not None})
    return comp


TABLE_COLUMN_TYPES = frozenset(
    {"auto", "text", "number", "link", "badge", "tag", "image", "progress", "date", "sparkline"}
)


def _table_column(col: Any) -> dict:
    """One ``columns`` entry (a label or a dict) → a column dict with ``key`` and ``label``."""
    if isinstance(col, str):
        return {"key": col, "label": col}
    if not isinstance(col, Mapping):
        raise TypeError("each column must be a label string or a dict")
    out = dict(col)
    key = out.get("key", out.get("label"))
    if key in (None, ""):
        raise ValueError("a column needs a 'key' or a 'label'")
    out.update(key=str(key), label=str(out.get("label", key)))
    if (kind := out.get("type", "auto")) not in TABLE_COLUMN_TYPES:
        raise ValueError(f"column type must be one of {sorted(TABLE_COLUMN_TYPES)}, not {kind!r}")
    return out


def table(
    *,
    headers: Sequence[str] | None = None,
    rows: Sequence[Sequence[Any] | Mapping[str, Any]],
    row_ids: Sequence[str] | None = None,
    actions: Sequence[str] | None = None,
    columns: Sequence[str | Mapping[str, Any]] | None = None,
    searchable: bool = False,
    page_size: int | None = None,
    sortable: bool = True,
    row_href_key: str | None = None,
    row_detail: bool = False,
    detail_key: str | None = None,
    detail_load_key: str | None = None,
    detail_load: str | None = None,
    max_height: int | str | None = None,
    caption: str | None = None,
) -> dict:
    """A data table: typed cells, header sorting, search, paging, row links and a row panel.

    Args:
        headers: Column header labels (or give ``columns``)
        rows: Row arrays in column order, or dicts keyed by column ``key``
        row_ids: Optional stable ID per row. When given, rows are selectable
            (click, Enter or Space) and emit a bubbling ``aiui:table-select``
            DOM event with ``detail = {rowId, index}``.
        actions: Optional row action labels (requires ``row_ids``). Each row
            gets one button per action, emitting a bubbling
            ``aiui:table-action`` DOM event with ``detail = {action, rowId}``.
        columns: Labels, or column dicts (``key``, ``label``, ``type``, ``format``,
            ``tones``, ``tone_above``, ``tone_below``, ``thresholds``, ...;
            see docs/api/components.md)
        searchable: Show a search box that filters rows in the browser
        page_size: Rows per page; 0 shows every row. Unset: 50 per page past 100 rows
        sortable: False turns header sorting off for every column
        row_href_key: Key (in dict rows, or a column key) holding each row's link
        row_detail: A click (or Enter) on a row opens a side panel with its fields
        detail_key: Key in dict rows holding a list of block dicts the side panel
            shows instead of the fields (implies ``row_detail``)
        detail_load_key: Key in dict rows holding a lazy section key (loaded via
            ``POST /api/pages/{id}/action`` with ``{"_lazy": key, "_params": ...}``
            only when that row's side panel opens; implies ``row_detail``)
        detail_load: Prefix for lazy row detail keys (``f"{detail_load}{row_id_or_index}"``;
            implies ``row_detail``)
        max_height: Scroll height (px or CSS length, 0 for none; default 70vh)
        caption: Accessible name of the table (and of its search box)
    """
    rows = list(rows)
    cols = [_table_column(c) for c in columns] if columns is not None else None
    if headers is None:
        if cols is None:
            raise ValueError("table() needs headers or columns")
        headers = [c["label"] for c in cols]
    elif cols is not None and len(cols) != len(headers):
        raise ValueError("headers and columns must have the same length")
    keys = [c["key"] for c in cols] if cols is not None else [str(h) for h in headers]

    def value(row: Any, key: str) -> Any:
        if isinstance(row, Mapping):
            return row.get(key)
        return row[keys.index(key)] if key in keys and keys.index(key) < len(row) else None

    out_rows: list[list[Any]] = []
    for row in rows:
        cells = [row.get(k) for k in keys] if isinstance(row, Mapping) else list(row)
        for i, col in enumerate(cols or []):
            # A link column with ``href_key`` takes each cell's link from that key.
            href_key = col.get("href_key")
            href = value(row, href_key) if href_key and i < len(cells) else None
            if href and not isinstance(cells[i], Mapping):
                cells[i] = {"text": "" if cells[i] is None else str(cells[i]), "href": str(href)}
        out_rows.append(cells)

    comp: dict[str, Any] = {"type": "table", "headers": list(headers), "rows": out_rows}
    if cols is not None:
        comp["columns"] = [{k: v for k, v in c.items() if k != "href_key"} for c in cols]
    if row_ids is not None:
        ids = [str(i) for i in row_ids]
        if len(ids) != len(comp["rows"]):
            raise ValueError("row_ids must have one entry per row")
        if len(set(ids)) != len(ids):
            raise ValueError("row_ids must be unique")
        comp["row_ids"] = ids
    if actions:
        if row_ids is None:
            raise ValueError("actions require row_ids")
        comp["actions"] = [str(a) for a in actions]
    if page_size is not None and page_size < 0:
        raise ValueError("page_size must be 0 or more")
    opts = {
        "searchable": True if searchable else None,
        "page_size": None if page_size is None else int(page_size),
        "sortable": None if sortable else False,
        "max_height": max_height,
        "caption": caption or None,
    }
    comp.update({k: v for k, v in opts.items() if v is not None})
    if row_href_key:
        comp["row_hrefs"] = [
            None if (h := value(r, row_href_key)) in (None, "") else str(h) for r in rows
        ]
    if detail_key:
        comp["row_details"] = [
            list(d) if isinstance(d := value(r, detail_key), (list, tuple)) else [] for r in rows
        ]
    if detail_load_key:
        comp["row_detail_loads"] = [
            None if (k := value(r, detail_load_key)) in (None, "") else str(k) for r in rows
        ]
    if detail_load:
        comp["detail_load"] = str(detail_load)
    if row_detail or detail_key or detail_load_key or detail_load:
        comp["row_detail"] = True
    return comp


def text(content: str) -> dict:
    """A text block.

    Args:
        content: Plain text content
    """
    return {"type": "text", "content": content}


# ── Tier 1: Essential Components ─────────────────────────────────────


def metric(
    label: str,
    *,
    value: Any,
    delta: str | None = None,
    delta_color: str = "normal",
    caption: str | None = None,
    help: str | None = None,
    sparkline: Sequence[float] | None = None,
    benchmark: float | None = None,
    benchmark_label: str | None = None,
) -> dict:
    """A metric card with optional delta indicator.

    Args:
        label: Metric label (e.g. "Total Users")
        value: Main metric value
        delta: Change indicator (e.g. "+5%"); a leading +/- colours it
        delta_color: Color hint — "normal", "inverse" (a fall is good, e.g.
            "-3 days" to ship) or "off" (never coloured)
        caption: A neutral note under the value (e.g. "median", "last 30
            days"), never coloured. ``help`` is an alias.
        sparkline: Numbers drawn as a tiny trend line under the value.
        benchmark: A number the value is compared with, shown as e.g.
            "17x below median" (coloured like ``delta``, ``delta_color`` applies).
        benchmark_label: Name of the benchmark (default "benchmark").
    """
    comp: dict[str, Any] = {"type": "metric", "label": label, "value": value}
    if delta is not None:
        comp["delta"] = delta
    if delta_color != "normal":
        comp["delta_color"] = delta_color
    note = caption if caption is not None else help
    if note is not None:
        comp["caption"] = note
    if sparkline is not None:
        comp["sparkline"] = [float(v) for v in sparkline]
    if benchmark is not None:
        comp["benchmark"] = float(benchmark)
    if benchmark_label is not None:
        comp["benchmark_label"] = benchmark_label
    return comp


def progress_bar(label: str, *, value: int | float, max_value: int | float = 100) -> dict:
    """A progress bar.

    Args:
        label: Label above the bar
        value: Current value
        max_value: Maximum value (default 100)
    """
    return {"type": "progress_bar", "label": label, "value": value, "max_value": max_value}


def alert(message: str, *, variant: str = "info", title: str | None = None) -> dict:
    """An alert/notification box.

    Args:
        message: Alert body, sanitised Markdown in the app shell (lists,
            bold, links; single newlines break the line)
        variant: "info", "success", "warning", or "error"
        title: Optional bold title
    """
    comp: dict[str, Any] = {"type": "alert", "message": message, "variant": variant}
    if title is not None:
        comp["title"] = title
    return comp


def badge(text: str, *, variant: str = "default") -> dict:
    """An inline badge/tag.

    Args:
        text: Badge label
        variant: "default", "secondary", "destructive", or "outline"
    """
    return {"type": "badge", "text": text, "variant": variant}


def separator() -> dict:
    """A horizontal separator line."""
    return {"type": "separator"}


def tabs(items: Sequence[dict], *, lazy: bool = False) -> dict:
    """A tabbed container.

    Args:
        items: List of ``{"label": str, "children": [comp_dicts]}``
        lazy: App shell: an item without ``children`` is fetched when its tab
            is first opened. The page's action handler receives
            ``{"_lazy": item.get("load", label), "_params": {...}}`` and
            returns ``aiui.layout([...])``.
    """
    comp: dict[str, Any] = {"type": "tabs", "items": list(items)}
    if lazy:
        comp["lazy"] = True
    return comp


def accordion(items: Sequence[dict]) -> dict:
    """A collapsible accordion.

    Args:
        items: List of ``{"title": str, "content": str_or_comp}``
    """
    return {"type": "accordion", "items": list(items)}


def image_display(
    src: str, *, alt: str = "", caption: str | None = None, width: str | None = None
) -> dict:
    """An image with optional caption.

    Args:
        src: Image URL or path
        alt: Alt text for accessibility
        caption: Optional caption below the image
        width: Optional CSS width (e.g. "300px", "50%")
    """
    comp: dict[str, Any] = {"type": "image_display", "src": src, "alt": alt}
    if caption is not None:
        comp["caption"] = caption
    if width is not None:
        comp["width"] = width
    return comp


def code_block(code: str, *, language: str = "text") -> dict:
    """A code block with syntax highlighting hint.

    Args:
        code: Source code text
        language: Language for syntax highlighting
    """
    return {"type": "code_block", "code": code, "language": language}


def json_view(data: Any) -> dict:
    """A formatted JSON viewer.

    Args:
        data: Any JSON-serializable data
    """
    return {"type": "json_view", "data": data}


# ── Tier 2: Form Input Components ───────────────────────────────────


def text_input(
    label: str,
    *,
    value: str = "",
    placeholder: str = "",
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A text input field.

    Args:
        label: Input label
        value: Default value
        placeholder: Placeholder text
        name: Optional explicit submit-key for ``form_action``. When
            omitted, the form collector falls back to ``label``. Use
            ``name`` whenever you have duplicate labels or want a stable
            machine-readable key.
        auto_submit: Submit the enclosing form when the value changes
            (debounced while typing).
    """
    comp: dict[str, Any] = {
        "type": "text_input",
        "label": label,
        "value": value,
        "placeholder": placeholder,
    }
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def number_input(
    label: str,
    *,
    value: int | float = 0,
    min_val: int | float | None = None,
    max_val: int | float | None = None,
    step: int | float = 1,
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A number input field.

    Args:
        label: Input label
        value: Default value
        min_val: Minimum allowed value
        max_val: Maximum allowed value
        step: Increment step
        name: Optional explicit submit-key for ``form_action``.
        auto_submit: Submit the enclosing form when the value changes
            (text is debounced).
    """
    comp: dict[str, Any] = {"type": "number_input", "label": label, "value": value, "step": step}
    if min_val is not None:
        comp["min_val"] = min_val
    if max_val is not None:
        comp["max_val"] = max_val
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def select_input(
    label: str,
    *,
    options: Sequence[Any] = (),
    value: str = "",
    name: str | None = None,
    searchable: bool | None = None,
    options_url: str | None = None,
    placeholder: str | None = None,
    selected_label: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A dropdown select input.

    Args:
        label: Input label
        options: List of option strings or ``{"value", "label"}`` dicts
        value: Default selected value
        name: Optional explicit submit-key for ``form_action``.
        searchable: ``True`` shows a type-to-search list (a combobox) instead
            of a plain dropdown; ``None`` (default) does so when there are
            more than 20 options or ``options_url`` is set; ``False`` never does.
        options_url: Optional same-origin endpoint accepting ``?q=<query>`` and
            returning JSON ``list`` or ``{"options": [...]}`` for server-loaded search.
        placeholder: Placeholder text for the searchable combobox trigger.
        selected_label: Display label for ``value`` when using ``options_url``
            before the remote options are fetched.
        auto_submit: Submit the enclosing form when the value changes.
    """
    comp: dict[str, Any] = {
        "type": "select_input",
        "label": label,
        "options": list(options),
        "value": value,
    }
    if name is not None:
        comp["name"] = name
    if searchable is not None:
        comp["searchable"] = searchable
    if options_url is not None:
        comp["options_url"] = options_url
    if placeholder is not None:
        comp["placeholder"] = placeholder
    if selected_label is not None:
        comp["selected_label"] = selected_label
    return _auto(comp, auto_submit)


def slider_input(
    label: str,
    *,
    value: int | float = 0,
    min_val: int | float = 0,
    max_val: int | float = 100,
    step: int | float = 1,
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A slider input.

    Args:
        label: Input label
        value: Default value
        min_val: Minimum value
        max_val: Maximum value
        step: Increment step
        name: Optional explicit submit-key for ``form_action``.
        auto_submit: Submit the enclosing form when the value changes.
    """
    comp: dict[str, Any] = {
        "type": "slider_input",
        "label": label,
        "value": value,
        "min_val": min_val,
        "max_val": max_val,
        "step": step,
    }
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def checkbox_input(
    label: str,
    *,
    checked: bool = False,
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A checkbox input.

    Args:
        label: Checkbox label
        checked: Default checked state
        name: Optional explicit submit-key for ``form_action``.
        auto_submit: Submit the enclosing form when the value changes.
    """
    comp: dict[str, Any] = {"type": "checkbox_input", "label": label, "checked": checked}
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def switch_input(
    label: str,
    *,
    checked: bool = False,
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A toggle switch input.

    Args:
        label: Switch label
        checked: Default checked state
        name: Optional explicit submit-key for ``form_action``.
        auto_submit: Submit the enclosing form when the value changes.
    """
    comp: dict[str, Any] = {"type": "switch_input", "label": label, "checked": checked}
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def radio_input(
    label: str,
    *,
    options: Sequence[str],
    value: str = "",
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A radio button group.

    Args:
        label: Group label
        options: List of option strings
        value: Default selected value
        name: Optional explicit submit-key for ``form_action``.
        auto_submit: Submit the enclosing form when the value changes.
    """
    comp: dict[str, Any] = {
        "type": "radio_input",
        "label": label,
        "options": list(options),
        "value": value,
    }
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def textarea_input(
    label: str,
    *,
    value: str = "",
    placeholder: str = "",
    rows: int = 4,
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A multi-line text area input.

    Args:
        label: Input label
        value: Default value
        placeholder: Placeholder text
        rows: Number of visible rows
        name: Optional explicit submit-key for ``form_action``.
        auto_submit: Submit the enclosing form when the value changes.
    """
    comp: dict[str, Any] = {
        "type": "textarea_input",
        "label": label,
        "value": value,
        "placeholder": placeholder,
        "rows": rows,
    }
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


# ── Tier 3: Layout & Advanced Components ─────────────────────────────


def container(children: Sequence[dict], *, title: str | None = None) -> dict:
    """A container wrapper with optional title.

    Args:
        children: List of child component dicts
        title: Optional heading above children
    """
    comp: dict[str, Any] = {"type": "container", "children": list(children)}
    if title is not None:
        comp["title"] = title
    return comp


def expander(
    title: str,
    *,
    children: Sequence[dict] = (),
    expanded: bool = False,
    lazy: bool = False,
    load: str | None = None,
) -> dict:
    """A collapsible section.

    Args:
        title: Section heading
        children: Content components
        expanded: Whether initially expanded
        lazy: App shell: fetch the body when first opened. The page's action
            handler receives ``{"_lazy": load, "_params": {...}}`` and returns
            ``aiui.layout([...])``.
        load: Key sent as ``_lazy`` (default: ``title``)
    """
    comp: dict[str, Any] = {
        "type": "expander", "title": title, "children": list(children), "expanded": expanded,
    }
    if lazy:
        comp["lazy"] = True
        comp["load"] = load or title
    return comp


def divider(text: str | None = None) -> dict:
    """A horizontal divider with optional center text.

    Args:
        text: Optional label displayed in the middle of the line
    """
    comp: dict[str, Any] = {"type": "divider"}
    if text is not None:
        comp["text"] = text
    return comp


def link(text: str, *, href: str, external: bool = False) -> dict:
    """A hyperlink.

    Args:
        text: Link text
        href: URL
        external: Whether to open in new tab
    """
    return {"type": "link", "text": text, "href": href, "external": external}


def button_group(buttons: Sequence[dict]) -> dict:
    """A row of buttons.

    Args:
        buttons: List of ``{"label": str, "variant": str}``
    """
    return {"type": "button_group", "buttons": list(buttons)}


def stat_group(stats: Sequence[dict]) -> dict:
    """A grid of stat/metric cards.

    Args:
        stats: List of ``{"label": str, "value": Any, "delta": str}``
    """
    return {"type": "stat_group", "stats": list(stats)}


def header(text: str, *, level: int = 1) -> dict:
    """A heading element.

    Args:
        text: Heading text
        level: Heading level 1-6
    """
    return {"type": "header", "text": text, "level": level}


def markdown_text(
    content: str,
    *,
    toc: bool = False,
    title: str | None = None,
) -> dict:
    """A markdown-rendered text block.

    The app shell renders sanitised Markdown: raw HTML that is not on the
    allow-list (``<svg>``, ``<script>``, ``style``, event handlers) is removed.
    Put HTML and SVG in :func:`html` instead.

    Args:
        content: Markdown content string
        toc: Show an "On this page" table of contents for ``##`` / ``###`` headings
        title: Optional document heading above the rendered markdown
    """
    comp: dict[str, Any] = {"type": "markdown_text", "content": content}
    if toc:
        comp["toc"] = True
    if title:
        comp["title"] = title
    return comp


def doc_viewer(
    content: str,
    *,
    title: str | None = None,
    toc: bool = True,
) -> dict:
    """A markdown document viewer with an automatic table of contents.

    Convenience wrapper around :func:`markdown_text` with ``toc=True`` by
    default.
    """
    return markdown_text(content, toc=toc, title=title)


def empty(text: str = "No data") -> dict:
    """An empty state placeholder.

    Args:
        text: Placeholder message
    """
    return {"type": "empty", "text": text}


def spinner(text: str = "Loading...") -> dict:
    """A loading spinner with text.

    Args:
        text: Loading message
    """
    return {"type": "spinner", "text": text}


def avatar(
    *,
    src: str | None = None,
    name: str | None = None,
    fallback: str | None = None,
    size: str | None = None,
) -> dict:
    """An avatar image or initials.

    Args:
        src: Image URL
        name: Display name (used for alt text)
        fallback: Fallback text when no image (e.g. initials)
        size: "sm", "default" or "lg" (optional)
    """
    comp: dict[str, Any] = {"type": "avatar"}
    if src is not None:
        comp["src"] = src
    if name is not None:
        comp["name"] = name
    if fallback is not None:
        comp["fallback"] = fallback
    if size is not None:
        comp["size"] = size
    return comp


def callout(content: str, *, variant: str = "info", title: str | None = None) -> dict:
    """A callout/highlight box.

    Args:
        content: Callout body, sanitised Markdown in the app shell (lists,
            bold, links; single newlines break the line)
        variant: "info", "success", "warning", or "error"
        title: Optional bold title
    """
    comp: dict[str, Any] = {"type": "callout", "content": content, "variant": variant}
    if title is not None:
        comp["title"] = title
    return comp


# ── Tier A: Must-Have (Streamlit + Gradio parity) ───────────────────


def multiselect_input(
    label: str,
    *,
    options: Sequence[Any] = (),
    value: Sequence[str] = (),
    name: str | None = None,
    placeholder: str | None = None,
    options_url: str | None = None,
    selected_labels: Mapping[str, str] | None = None,
    auto_submit: bool = False,
) -> dict:
    """A searchable multi-select: chosen values show as removable chips.

    In a form it posts a list of the chosen values under ``name`` (or ``label``).

    Args:
        label: Input label
        options: Choices: strings, or ``{"value", "label"}`` dicts
        value: Default selected values
        name: Optional explicit submit-key for ``form``.
        placeholder: Text of the "add" button when nothing is chosen.
        options_url: Optional same-origin endpoint accepting ``?q=<query>`` and
            returning JSON ``list`` or ``{"options": [...]}`` for server-loaded search.
        selected_labels: Optional ``{value: label}`` map for initially selected values
            when using ``options_url``.
        auto_submit: Submit the enclosing form when the selection changes.
    """
    comp: dict[str, Any] = {
        "type": "multiselect_input",
        "label": label,
        "options": list(options),
        "value": list(value),
    }
    if name is not None:
        comp["name"] = name
    if placeholder is not None:
        comp["placeholder"] = placeholder
    if options_url is not None:
        comp["options_url"] = options_url
    if selected_labels:
        comp["selected_labels"] = {str(k): str(v) for k, v in selected_labels.items()}
    return _auto(comp, auto_submit)


def tags_input(
    label: str,
    *,
    value: Sequence[str] = (),
    name: str | None = None,
    placeholder: str = "Add a tag",
    auto_submit: bool = False,
) -> dict:
    """Free-text tags: Enter or a comma turns the typed text into a chip.

    Backspace in the empty box removes the last chip. In a form it posts a
    list of strings under ``name`` (or ``label``).

    Args:
        label: Input label
        value: Default tags
        name: Optional explicit submit-key for ``form``.
        placeholder: Placeholder of the text box.
        auto_submit: Submit the enclosing form when a tag is added or removed.
    """
    comp: dict[str, Any] = {
        "type": "tags_input",
        "label": label,
        "value": list(value),
        "placeholder": placeholder,
    }
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def date_range_input(
    name: str,
    *,
    label: str | None = None,
    start: str | None = None,
    end: str | None = None,
    presets: Sequence[int | Mapping[str, Any]] = (7, 30, 90, 365),
    auto_submit: bool = False,
) -> dict:
    """A date range: preset buttons ("Last 30 days") and two date fields.

    In a form it posts ``<name>_start`` and ``<name>_end`` as ISO dates
    (``"2026-01-31"``) or ``""`` when a side is open. A preset sets the end to
    today and the start that many days before it (browser's local date).

    Args:
        name: Submit-key prefix.
        label: Label shown above the control.
        start: Default start date (ISO).
        end: Default end date (ISO).
        presets: Day counts, or ``{"days": 14, "label": "2 weeks"}`` dicts; ``()`` hides them.
        auto_submit: Submit the enclosing form when the range changes.
    """
    comp: dict[str, Any] = {
        "type": "date_range_input",
        "name": name,
        "label": label if label is not None else "",
        "start": start or "",
        "end": end or "",
        "presets": [dict(p) if isinstance(p, Mapping) else int(p) for p in presets],
    }
    return _auto(comp, auto_submit)


def segmented_input(
    name: str,
    options: Sequence[Any],
    *,
    label: str | None = None,
    value: str | Sequence[str] | None = None,
    multi: bool = False,
    auto_submit: bool = False,
) -> dict:
    """A row of toggle pills: one choice (``multi=False``) or several.

    In a form it posts the chosen value under ``name`` (a list when ``multi``).

    Args:
        name: Submit-key.
        options: Choices: strings, or ``{"value", "label"}`` dicts.
        label: Label shown above the pills.
        value: Default choice (a list when ``multi``). Single choice defaults to the first option.
        multi: Allow several pills to be on at once.
        auto_submit: Submit the enclosing form when the choice changes.
    """
    if multi:
        chosen: Any = [value] if isinstance(value, str) else list(value or ())
    else:
        chosen = value if isinstance(value, str) else ""
    comp: dict[str, Any] = {
        "type": "segmented_input",
        "name": name,
        "label": label if label is not None else "",
        "options": list(options),
        "value": chosen,
        "multi": multi,
    }
    return _auto(comp, auto_submit)


def date_input(
    label: str,
    *,
    value: str | None = None,
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A date picker input.

    Args:
        label: Input label
        value: Default date as ISO string (e.g. "2026-01-15")
        name: Optional explicit submit-key for ``form``
        auto_submit: Submit the enclosing form when the value changes
    """
    comp: dict[str, Any] = {"type": "date_input", "label": label}
    if value is not None:
        comp["value"] = value
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def color_picker_input(
    label: str,
    *,
    value: str = "#000000",
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A color picker input.

    Args:
        label: Input label
        value: Default hex color (e.g. "#ff5733")
        name: Optional explicit submit-key for ``form``
        auto_submit: Submit the enclosing form when the value changes
    """
    comp: dict[str, Any] = {"type": "color_picker_input", "label": label, "value": value}
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def audio_player(src: str, *, autoplay: bool = False, title: str | None = None) -> dict:
    """An audio player.

    Named ``audio_player`` to avoid collision with ``aiui.audio`` chat callback.

    Args:
        src: Audio file URL or path
        autoplay: Whether to auto-play
        title: Optional caption, also the player's accessible name
    """
    comp: dict[str, Any] = {"type": "audio_player", "src": src, "autoplay": autoplay}
    if title is not None:
        comp["title"] = title
    return comp


def video_player(
    src: str,
    *,
    autoplay: bool = False,
    poster: str | None = None,
    title: str | None = None,
) -> dict:
    """A video player.

    Named ``video_player`` to avoid collision with ``aiui.video`` chat callback.

    Args:
        src: Video file URL or path
        autoplay: Whether to auto-play (starts muted, as browsers require)
        poster: Poster image URL shown before playback
        title: Optional caption, also the player's accessible name
    """
    comp: dict[str, Any] = {"type": "video_player", "src": src, "autoplay": autoplay}
    if poster is not None:
        comp["poster"] = poster
    if title is not None:
        comp["title"] = title
    return comp


def file_download(
    label: str, *, href: str, filename: str | None = None, variant: str | None = None
) -> dict:
    """A file download link/button.

    Args:
        label: Button label text
        href: URL to the downloadable file
        filename: Suggested filename for the download
        variant: Button look: "outline" (default), "primary", "secondary", "ghost"
    """
    comp: dict[str, Any] = {"type": "file_download", "label": label, "href": href}
    if filename is not None:
        comp["filename"] = filename
    if variant is not None:
        comp["variant"] = variant
    return comp


# ── Tier B: High-Value Dashboard Components ──────────────────────────


def toast(message: str, *, variant: str = "info", duration: int = 3000) -> dict:
    """A toast notification.

    Args:
        message: Notification text
        variant: "info", "success", "warning", or "error"
        duration: Auto-dismiss time in milliseconds
    """
    return {"type": "toast", "message": message, "variant": variant, "duration": duration}


def dialog(
    title: str,
    *,
    children: Sequence[dict],
    description: str | None = None,
    trigger_label: str | None = None,
    variant: str | None = None,
) -> dict:
    """A button that opens a modal dialog with child components.

    Args:
        title: Dialog heading
        children: Content components inside the dialog
        description: Optional subtitle/description
        trigger_label: Text of the button that opens it (defaults to ``title``)
        variant: Look of that button: "outline" (default), "primary", "secondary", "ghost"
    """
    comp: dict[str, Any] = {"type": "dialog", "title": title, "children": list(children)}
    if description is not None:
        comp["description"] = description
    if trigger_label is not None:
        comp["trigger_label"] = trigger_label
    if variant is not None:
        comp["variant"] = variant
    return comp


def caption(text: str) -> dict:
    """Small muted caption text.

    Args:
        text: Caption content
    """
    return {"type": "caption", "text": text}


def _html_block(
    kind: str,
    content: str,
    *,
    height: int | str | None,
    csp: str | None,
    trusted: bool,
    title: str | None,
) -> dict:
    comp: dict[str, Any] = {"type": kind, "content": content}
    if height is not None:
        comp["height"] = height
    if csp is not None:
        comp["csp"] = csp
    if trusted:
        comp["trusted"] = True
    if title is not None:
        comp["title"] = title
    return comp


def html(
    content: str,
    *,
    height: int | str | None = None,
    csp: str | None = None,
    trusted: bool = False,
    title: str | None = None,
) -> dict:
    """App HTML or SVG, isolated from the page.

    In the app shell the content renders in a sandboxed iframe
    (``sandbox="allow-scripts"``, no same-origin): its scripts run in an
    opaque origin and cannot read the app's DOM, cookies, storage or API.
    A Content-Security-Policy blocks network access by default. The frame
    sizes itself to the content and gets the ``--aiui-*`` theme variables,
    updated when light/dark changes.

    Args:
        content: HTML string (may include ``<svg>``, ``<style>``, ``<script>``)
        height: Fixed height (pixels or a CSS length); default: fit the content
        csp: Content-Security-Policy for the frame, replacing the default
            ``default-src 'none'; img-src data: https:; style-src 'unsafe-inline';
            script-src 'unsafe-inline'; font-src data:; base-uri 'none';
            form-action 'none'``. Auto-sizing needs ``script-src 'unsafe-inline'``.
        trusted: Render inline in the page instead, through the sanitised
            Markdown pipeline: no scripts, event handlers, ``style`` or SVG.
        title: Accessible name of the frame (default "Embedded content")
    """
    return _html_block("html", content, height=height, csp=csp, trusted=trusted, title=title)


def html_embed(
    content: str,
    *,
    height: int | str | None = None,
    csp: str | None = None,
    trusted: bool = False,
    title: str | None = None,
) -> dict:
    """Older name of :func:`html`, with the same parameters and rendering in
    the app shell (a sandboxed frame).

    The legacy ``dashboard`` style still sets this block's HTML directly on
    the page (scripts and inline handlers run there): only pass content you
    wrote. Use :func:`html` for new code.
    """
    return _html_block("html_embed", content, height=height, csp=csp, trusted=trusted, title=title)


def skeleton(
    *,
    width: str | None = None,
    height: str | None = None,
    variant: str = "text",
) -> dict:
    """A skeleton loading placeholder.

    Args:
        width: CSS width (e.g. "200px", "100%")
        height: CSS height (e.g. "20px")
        variant: "text" (line), "card" (rectangle), or "avatar" (circle)
    """
    comp: dict[str, Any] = {"type": "skeleton", "variant": variant}
    if width is not None:
        comp["width"] = width
    if height is not None:
        comp["height"] = height
    return comp


def tooltip(child: dict, *, content: str) -> dict:
    """Wrap a component with a hover tooltip.

    Args:
        child: The component dict to wrap
        content: Tooltip text shown on hover

    .. versionadded:: 0.3.109
        Supersedes :func:`tooltip_wrap`, which remains as a deprecated alias.
    """
    return {"type": "tooltip_wrap", "child": child, "content": content}


def tooltip_wrap(child: dict, *, content: str) -> dict:
    """Deprecated alias for :func:`tooltip`.

    .. deprecated:: 0.3.109
        Use :func:`praisonaiui.tooltip` instead. Scheduled for removal
        in 0.5.0.
    """
    import warnings

    warnings.warn(
        "praisonaiui.tooltip_wrap is deprecated; use praisonaiui.tooltip instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return tooltip(child, content=content)


# ── Tier C: Completeness Components ──────────────────────────────────


def time_input(
    label: str,
    *,
    value: str | None = None,
    name: str | None = None,
    auto_submit: bool = False,
) -> dict:
    """A time picker input.

    Args:
        label: Input label
        value: Default time as "HH:MM" string
        name: Optional explicit submit-key for ``form``
        auto_submit: Submit the enclosing form when the value changes
    """
    comp: dict[str, Any] = {"type": "time_input", "label": label}
    if value is not None:
        comp["value"] = value
    if name is not None:
        comp["name"] = name
    return _auto(comp, auto_submit)


def list_detail(
    rows: Sequence[Mapping[str, Any]],
    *,
    columns: Sequence[str | Mapping[str, Any]] | None = None,
    title: str | None = None,
    page_size: int | None = None,
    search: bool | None = None,
    empty: str | None = None,
) -> dict:
    """A searchable list with a side detail panel (the ``list_detail`` template block).

    Args:
        rows: List of row dicts (optional ``id`` and ``detail`` key-value dict)
        columns: Column keys or ``{"key", "label", "align"}`` dicts
        title: Accessible label for the list
        page_size: Rows per page (default 25)
        search: Force the search box on even when rows fit on one page
        empty: Text shown when no rows match
    """
    comp: dict[str, Any] = {"type": "list_detail", "rows": [dict(r) for r in rows]}
    if columns is not None:
        comp["columns"] = [dict(c) if isinstance(c, Mapping) else str(c) for c in columns]
    if title is not None:
        comp["title"] = title
    if page_size is not None:
        comp["page_size"] = int(page_size)
    if search is not None:
        comp["search"] = bool(search)
    if empty is not None:
        comp["empty"] = empty
    return comp


def gallery(items: Sequence[dict]) -> dict:
    """An image/media gallery grid.

    Args:
        items: List of ``{"src": str, "alt": str, "caption": str}``. Optional
            per item: ``href`` (the tile opens this link), ``target``
            (e.g. ``"_blank"``), ``page`` (open an app page by id instead) and
            ``video`` (a video URL: the tile shows a play mark and opens it).
    """
    return {"type": "gallery", "items": list(items)}


def card_grid(items: Sequence[dict], *, columns: int = 3) -> dict:
    """A responsive grid of entity cards (one column on a phone).

    Args:
        items: List of cards. Each takes ``title`` and optionally
            ``subtitle``, ``description``, ``image`` (cover image URL),
            ``avatar`` (round image URL; initials of the title without one),
            ``stats`` (``[{"label": str, "value": Any}]``), ``badges``
            (strings or ``{"text": str, "variant": str}``), and ``href``
            (with ``target``) or ``page`` (an app page id) to make the card
            a link.
        columns: Columns on a wide screen (1-6)
    """
    return {"type": "card_grid", "items": list(items), "columns": columns}


def link_button(label: str, href: str, *, variant: str = "outline", external: bool = False) -> dict:
    """A link that looks like a button.

    A ``link`` block with a ``variant``, so older renderers show a plain link.

    Args:
        label: Button text
        href: Target URL
        variant: "outline" (default), "primary", "secondary", "ghost" or "link"
        external: Open in a new tab
    """
    return {"type": "link", "text": label, "href": href, "external": external, "variant": variant}


def page_link(
    page_id: str,
    label: str | None = None,
    *,
    variant: str | None = None,
    params: Mapping[str, Any] | None = None,
) -> dict:
    """A link to another page of the app, opened without a full reload.

    Args:
        page_id: Id of the target page (as given to ``@aiui.page``)
        label: Link text (defaults to the page id)
        variant: Render as a button ("outline", "primary", ...) instead of a text link
        params: Optional query parameters appended to the target URL
    """
    from urllib.parse import quote, urlencode

    href = "/" + quote(page_id, safe="")
    clean_params: dict[str, Any] = {}
    if params:
        pairs: list[tuple[str, str]] = []
        for key, value in params.items():
            if not key or str(key).startswith("_"):
                continue
            items = value if isinstance(value, (list, tuple)) else [value]
            kept: list[str] = []
            for item in items:
                if item is None or item is False or item == "":
                    continue
                text = "true" if item is True else str(item)
                pairs.append((str(key), text))
                kept.append(text)
            if kept:
                clean_params[str(key)] = kept if isinstance(value, (list, tuple)) else kept[0]
        if pairs:
            href = f"{href}?{urlencode(pairs)}"
    text = label if label is not None else page_id
    comp: dict[str, Any] = {"type": "link", "text": text, "href": href, "page": page_id}
    if clean_params:
        comp["params"] = clean_params
    if variant is not None:
        comp["variant"] = variant
    return comp


def breadcrumb(items: Sequence[dict]) -> dict:
    """A breadcrumb navigation trail.

    Args:
        items: List of ``{"label": str, "href": str|None}``
    """
    return {"type": "breadcrumb", "items": list(items)}


def pagination(
    *,
    total: int,
    page: int = 1,
    per_page: int = 10,
    id: str | None = None,
    action: str | None = None,
) -> dict:
    """Pagination controls.

    Clicking a page updates the control and dispatches a bubbling
    ``aiui:pagination`` DOM event with ``{id, page, per_page, total}`` so
    the host can re-slice or fetch rows. When ``action`` is set in the app
    shell, clicking a page also posts ``{action, page, per_page, ...}`` to
    the page action endpoint.

    Args:
        total: Total number of items
        page: Current page number (1-based)
        per_page: Items per page
        id: Optional identifier echoed in the event to tell controls apart
        action: Optional page action name to POST when a page is selected
    """
    comp: dict[str, Any] = {
        "type": "pagination",
        "total": total,
        "page": page,
        "per_page": per_page,
    }
    if id is not None:
        comp["id"] = id
    if action is not None:
        comp["action"] = action
    return comp


def definition_list(items: Sequence[dict], *, title: str | None = None) -> dict:
    """A label/value definition list.

    Args:
        items: List of ``{"label": str, "value": Any}``
        title: Optional heading above the list

    .. versionadded:: 0.3.109
        Supersedes :func:`key_value_list`.
    """
    comp: dict[str, Any] = {"type": "key_value_list", "items": list(items)}
    if title is not None:
        comp["title"] = title
    return comp


def key_value_list(items: Sequence[dict], *, title: str | None = None) -> dict:
    """Deprecated alias for :func:`definition_list`.

    .. deprecated:: 0.3.109
        Use :func:`praisonaiui.definition_list` instead. Scheduled for
        removal in 0.5.0.
    """
    import warnings

    warnings.warn(
        "praisonaiui.key_value_list is deprecated; use praisonaiui.definition_list instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return definition_list(items, title=title)


def popover(trigger: dict, *, children: Sequence[dict]) -> dict:
    """A popover overlay triggered by a component.

    Args:
        trigger: The component dict that triggers the popover
        children: Content components inside the popover
    """
    return {"type": "popover", "trigger": trigger, "children": list(children)}


def form(
    action: str,
    *,
    children: Sequence[dict],
    submit_label: str = "Submit",
    method: str = "post",
    update_url: bool = False,
    submit_on_change: bool = False,
) -> dict:
    """A form container that submits input values to the server.

    When the user clicks submit, the frontend collects all input values
    from ``children`` and POSTs them to ``/api/pages/{page_id}/action``.

    Args:
        action: Action identifier (typically matches the page_id).
        children: Form input components (text_input, select_input, etc.).
        submit_label: Label for the submit button. Default ``"Submit"``.
        method: ``"get"`` (app shell): write the values into the page URL's
            query string and re-fetch the page data, which the page handler
            receives as ``params``. No action handler is needed.
        update_url: ``method="post"`` (app shell): after a successful
            action, also write the submitted values into the page URL.
        submit_on_change: Submit whenever an input changes (text is debounced
            by 400 ms). Off by default: leave it off for a form whose submit
            starts a job, and use ``auto_submit=True`` on single inputs instead.

    .. versionadded:: 0.3.109
        Supersedes :func:`form_action`.
    """
    comp: dict[str, Any] = {
        "type": "form_action",
        "action": action,
        "children": list(children),
        "submit_label": submit_label,
    }
    if method.lower() == "get":
        comp["method"] = "get"
    if update_url:
        comp["update_url"] = True
    if submit_on_change:
        comp["submit_on_change"] = True
    return comp


def form_action(
    action: str,
    *,
    children: Sequence[dict],
    submit_label: str = "Submit",
) -> dict:
    """Deprecated alias for :func:`form`.

    .. deprecated:: 0.3.109
        Use :func:`praisonaiui.form` instead. Scheduled for removal
        in 0.5.0.
    """
    import warnings

    warnings.warn(
        "praisonaiui.form_action is deprecated; use praisonaiui.form instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return form(action, children=children, submit_label=submit_label)


STATUS_STATES = ("queued", "running", "done", "failed")


def status(
    label: str,
    *,
    state: str = "running",
    detail: str | None = None,
    progress: int | float | None = None,
    log: Sequence[str] | None = None,
) -> dict:
    """A job status row: state icon, label, detail, progress and a log tail.

    Pair it with ``refresh_every`` on the page so the row updates while
    the job runs.

    Args:
        label: What runs, e.g. ``"Sync YouTube"``.
        state: ``"queued"``, ``"running"``, ``"done"`` or ``"failed"``.
        detail: One line under the label, e.g. ``"12 of 40 channels"``.
        progress: Percent done (0-100); a bar is shown when set.
        log: Recent log lines, shown in a log viewer below the row.
    """
    if state not in STATUS_STATES:
        raise ValueError(f"state must be one of {', '.join(STATUS_STATES)}")
    comp: dict[str, Any] = {"type": "status", "label": label, "state": state}
    if detail is not None:
        comp["detail"] = detail
    if progress is not None:
        comp["progress"] = max(0, min(100, progress))
    if log:
        comp["log"] = [str(line) for line in log]
    return comp


def filter_bar(
    action: str = "",
    *,
    inputs: Sequence[dict],
    chips: bool = True,
    defaults: Mapping[str, Any] | None = None,
    reset_label: str = "Reset",
    method: str = "post",
    update_url: bool = False,
) -> dict:
    """A compact row of filters that applies as soon as one changes.

    It posts like :func:`form` (every input by ``name`` to the page action
    ``action``, normally the page id), so the action handler should return the
    page rebuilt from the posted values. Pass ``method="get"`` to write the
    filter values directly into the page URL and re-fetch the page data without
    an action handler. With ``chips``, each active filter shows as a chip with
    a button that clears it, plus a "Reset" control that clears them all. A
    filter is active when its value differs from its reset value:
    ``defaults[name]`` when given, else the first option of a select, radio or
    single segmented input, else empty. Number and slider inputs show a chip
    only when ``defaults`` names them.

    Args:
        action: Action identifier (typically the page id; optional with ``method="get"``).
        inputs: Input components (``select_input``, ``multiselect_input``,
            ``date_range_input``, ``segmented_input``, ``text_input``, ...).
        chips: Show the active filters as removable chips.
        defaults: Reset value per input name (a date range takes ``{"start", "end"}``).
        reset_label: Label of the control that clears every filter.
        method: ``"post"`` (default) or ``"get"`` (write values into the URL
            query string and re-fetch page data).
        update_url: With ``method="post"``, also write submitted values into
            the page URL after a successful action.
    """
    comp: dict[str, Any] = {
        "type": "filter_bar",
        "action": action,
        "children": list(inputs),
        "chips": chips,
        "reset_label": reset_label,
    }
    if defaults:
        comp["defaults"] = dict(defaults)
    if method.lower() == "get":
        comp["method"] = "get"
    if update_url:
        comp["update_url"] = True
    return comp
