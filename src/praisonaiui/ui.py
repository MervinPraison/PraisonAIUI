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


# ── Tier 1: Essential Components ─────────────────────────────────────


def metric(
    label: str,
    *,
    value: Any,
    delta: str | None = None,
    delta_color: str = "normal",
) -> dict:
    """A metric card with optional delta indicator.

    Args:
        label: Metric label (e.g. "Total Users")
        value: Main metric value
        delta: Change indicator (e.g. "+5%")
        delta_color: Color hint — "normal", "inverse", or "off"
    """
    comp: dict[str, Any] = {"type": "metric", "label": label, "value": value}
    if delta is not None:
        comp["delta"] = delta
    if delta_color != "normal":
        comp["delta_color"] = delta_color
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
        message: Alert body text
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


def tabs(items: Sequence[dict]) -> dict:
    """A tabbed container.

    Args:
        items: List of ``{"label": str, "children": [comp_dicts]}``
    """
    return {"type": "tabs", "items": list(items)}


def accordion(items: Sequence[dict]) -> dict:
    """A collapsible accordion.

    Args:
        items: List of ``{"title": str, "content": str_or_comp}``
    """
    return {"type": "accordion", "items": list(items)}


def image_display(src: str, *, alt: str = "", caption: str | None = None, width: str | None = None) -> dict:
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


def text_input(label: str, *, value: str = "", placeholder: str = "") -> dict:
    """A text input field.

    Args:
        label: Input label
        value: Default value
        placeholder: Placeholder text
    """
    return {"type": "text_input", "label": label, "value": value, "placeholder": placeholder}


def number_input(
    label: str,
    *,
    value: int | float = 0,
    min_val: int | float | None = None,
    max_val: int | float | None = None,
    step: int | float = 1,
) -> dict:
    """A number input field.

    Args:
        label: Input label
        value: Default value
        min_val: Minimum allowed value
        max_val: Maximum allowed value
        step: Increment step
    """
    comp: dict[str, Any] = {"type": "number_input", "label": label, "value": value, "step": step}
    if min_val is not None:
        comp["min_val"] = min_val
    if max_val is not None:
        comp["max_val"] = max_val
    return comp


def select_input(label: str, *, options: Sequence[str], value: str = "") -> dict:
    """A dropdown select input.

    Args:
        label: Input label
        options: List of option strings
        value: Default selected value
    """
    return {"type": "select_input", "label": label, "options": list(options), "value": value}


def slider_input(
    label: str,
    *,
    value: int | float = 0,
    min_val: int | float = 0,
    max_val: int | float = 100,
    step: int | float = 1,
) -> dict:
    """A slider input.

    Args:
        label: Input label
        value: Default value
        min_val: Minimum value
        max_val: Maximum value
        step: Increment step
    """
    return {
        "type": "slider_input", "label": label, "value": value,
        "min_val": min_val, "max_val": max_val, "step": step,
    }


def checkbox_input(label: str, *, checked: bool = False) -> dict:
    """A checkbox input.

    Args:
        label: Checkbox label
        checked: Default checked state
    """
    return {"type": "checkbox_input", "label": label, "checked": checked}


def switch_input(label: str, *, checked: bool = False) -> dict:
    """A toggle switch input.

    Args:
        label: Switch label
        checked: Default checked state
    """
    return {"type": "switch_input", "label": label, "checked": checked}


def radio_input(label: str, *, options: Sequence[str], value: str = "") -> dict:
    """A radio button group.

    Args:
        label: Group label
        options: List of option strings
        value: Default selected value
    """
    return {"type": "radio_input", "label": label, "options": list(options), "value": value}


def textarea_input(label: str, *, value: str = "", placeholder: str = "", rows: int = 4) -> dict:
    """A multi-line text area input.

    Args:
        label: Input label
        value: Default value
        placeholder: Placeholder text
        rows: Number of visible rows
    """
    return {"type": "textarea_input", "label": label, "value": value, "placeholder": placeholder, "rows": rows}


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


def expander(title: str, *, children: Sequence[dict], expanded: bool = False) -> dict:
    """A collapsible section.

    Args:
        title: Section heading
        children: Content components
        expanded: Whether initially expanded
    """
    return {"type": "expander", "title": title, "children": list(children), "expanded": expanded}


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


def markdown_text(content: str) -> dict:
    """A markdown-rendered text block.

    Args:
        content: Markdown content string
    """
    return {"type": "markdown_text", "content": content}


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


def avatar(*, src: str | None = None, name: str | None = None, fallback: str | None = None) -> dict:
    """An avatar image or initials.

    Args:
        src: Image URL
        name: Display name (used for alt text)
        fallback: Fallback text when no image (e.g. initials)
    """
    comp: dict[str, Any] = {"type": "avatar"}
    if src is not None:
        comp["src"] = src
    if name is not None:
        comp["name"] = name
    if fallback is not None:
        comp["fallback"] = fallback
    return comp


def callout(content: str, *, variant: str = "info", title: str | None = None) -> dict:
    """A callout/highlight box.

    Args:
        content: Callout body text
        variant: "info", "success", "warning", or "error"
        title: Optional bold title
    """
    comp: dict[str, Any] = {"type": "callout", "content": content, "variant": variant}
    if title is not None:
        comp["title"] = title
    return comp
