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

from typing import Any, Sequence


def layout(children: Sequence[dict]) -> dict:
    """Wrap components in a layout container.

    The returned dict is served as JSON by the page handler.
    The dashboard.js plugin detects the ``_components`` key
    and renders each child component.

    Args:
        children: List of component dicts (from card(), columns(), etc.)
    """
    return {"_components": list(children)}


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


def chart(
    title: str,
    *,
    data: Sequence[dict] | None = None,
    chart_type: str = "bar",
) -> dict:
    """A chart placeholder.

    Args:
        title: Chart title
        data: List of data point dicts
        chart_type: Type of chart (bar, line, pie)
    """
    return {
        "type": "chart",
        "title": title,
        "data": list(data or []),
        "chart_type": chart_type,
    }


def table(
    *,
    headers: Sequence[str],
    rows: Sequence[Sequence[Any]],
) -> dict:
    """A data table.

    Args:
        headers: Column header labels
        rows: List of row arrays
    """
    return {
        "type": "table",
        "headers": list(headers),
        "rows": [list(r) for r in rows],
    }


def text(content: str) -> dict:
    """A text block.

    Args:
        content: Plain text content
    """
    return {"type": "text", "content": content}
