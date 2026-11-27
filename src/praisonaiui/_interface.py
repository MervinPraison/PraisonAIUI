"""5-line Gradio-style interface builder on top of ``@aiui.page`` and ``@aiui.register_page_action``.

Compiles a single Python function (sync, async, sync generator, or async generator)
plus input block specs into an interactive page with zero new frontend code or routes.

Example::

    import praisonaiui as aiui

    def summarize(text: str, tone: str = "Brief"):
        return f"**{tone} summary:** {text[:120]}"

    aiui.interface(
        summarize,
        inputs=[
            aiui.textarea_input("Text", name="text", placeholder="Paste text..."),
            aiui.select_input("Tone", name="tone", options=["Brief", "Detailed"], value="Brief"),
        ],
        title="Summarizer",
    )
"""

from __future__ import annotations

import asyncio
import inspect
import re
from typing import Any, Callable, Mapping, Sequence

from praisonaiui import ui

_SHORTHAND_INPUTS: dict[str, Callable[[str, str], dict[str, Any]]] = {
    "text": lambda name, label: ui.text_input(label, name=name),
    "textbox": lambda name, label: ui.text_input(label, name=name),
    "textarea": lambda name, label: ui.textarea_input(label, name=name),
    "number": lambda name, label: ui.number_input(label, name=name),
    "checkbox": lambda name, label: ui.checkbox_input(label, name=name),
    "bool": lambda name, label: ui.checkbox_input(label, name=name),
    "file": lambda name, label: ui.file_upload(label, name=name),
}


def _slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.strip().lower()).strip("-")
    return slug or "app"


def _normalize_input(spec: str | Mapping[str, Any], index: int, param_name: str | None) -> dict[str, Any]:
    if isinstance(spec, str):
        key = spec.strip().lower()
        builder = _SHORTHAND_INPUTS.get(key)
        if builder is None:
            valid = ", ".join(sorted(_SHORTHAND_INPUTS))
            raise ValueError(f"Unknown shorthand input {spec!r}. Use one of: {valid}, or an aiui.* input block.")
        name = param_name or f"input_{index + 1}"
        label = name.replace("_", " ").title()
        return builder(name, label)
    if isinstance(spec, Mapping) and isinstance(spec.get("type"), str):
        block = dict(spec)
        if not block.get("name"):
            block["name"] = param_name or _slugify(str(block.get("label") or f"input_{index + 1}"))
        return block
    raise TypeError(f"Each input must be a shorthand string or an aiui.* input block dict, got {type(spec).__name__}")


def _hydrate_inputs(inputs: Sequence[dict[str, Any]], values: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Copy input blocks with submitted values preserved so users can tweak and re-run."""
    hydrated: list[dict[str, Any]] = []
    for inp in inputs:
        copy = dict(inp)
        name = str(copy.get("name") or "")
        if name and name in values:
            val = values[name]
            kind = copy.get("type")
            if kind in ("checkbox_input", "switch_input"):
                copy["checked"] = bool(val)
            elif kind != "file_upload":
                copy["value"] = val
        hydrated.append(copy)
    return hydrated


def _resolve_input_value(inp: Mapping[str, Any], raw_val: Any) -> Any:
    """Resolve uploaded file handles to verified server file metadata when applicable."""
    if inp.get("type") != "file_upload" or raw_val is None:
        return raw_val
    from praisonaiui.features.attachments import get_uploaded_file

    if isinstance(raw_val, list):
        return [get_uploaded_file(item) or item for item in raw_val]
    return get_uploaded_file(raw_val) or raw_val


def _format_output(result: Any, outputs: str) -> list[dict[str, Any]]:
    """Convert any Python return value into one or more ``aiui.*`` blocks."""
    if result is None:
        return []
    if isinstance(result, Mapping):
        if isinstance(result.get("_components"), list):
            return list(result["_components"])
        if isinstance(result.get("type"), str) and result["type"]:
            return [dict(result)]
        if outputs == "blocks":
            return [dict(result)]
        return [ui.json_view(dict(result))]
    if isinstance(result, (list, tuple)):
        if result and all(isinstance(x, Mapping) and isinstance(x.get("type"), str) for x in result):
            return [dict(x) for x in result]
        if result and all(isinstance(x, Mapping) for x in result) and outputs in ("auto", "table"):
            return [ui.table(result, searchable=True)]
        return [ui.json_view(list(result))]
    if ui._coerce_dataframe(result) is not None:
        return [ui.table(result, searchable=True)]
    if callable(getattr(result, "to_dict", None)) and callable(getattr(result, "to_json", None)):
        return [ui.plotly_chart(result)]
    text_val = str(result)
    if outputs == "text":
        return [ui.text(text_val)]
    if outputs == "code":
        return [ui.code_block(text_val)]
    if outputs == "json":
        return [ui.json_view(result)]
    return [ui.markdown_text(text_val)]


def _invoke(fn: Callable[..., Any], input_blocks: Sequence[dict[str, Any]], data: Mapping[str, Any]) -> Any:
    values = [_resolve_input_value(inp, data.get(str(inp["name"]))) for inp in input_blocks]
    by_name = {str(inp["name"]): val for inp, val in zip(input_blocks, values)}
    sig = inspect.signature(fn)
    params = list(sig.parameters.values())
    if not params:
        return fn()
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params):
        return fn(**by_name)
    if all(p.name in by_name for p in params if p.default is inspect.Parameter.empty):
        kwargs = {p.name: by_name[p.name] for p in params if p.name in by_name}
        return fn(**kwargs)
    return fn(*values[: len(params)])


def interface(
    fn: Callable[..., Any],
    *,
    inputs: Sequence[str | Mapping[str, Any]] | str | Mapping[str, Any] = ("text",),
    outputs: str = "auto",
    title: str = "App",
    id: str | None = None,
    description: str = "",
    icon: str = "sparkles",
    group: str = "Apps",
    submit_label: str = "Run",
    order: int = 10,
) -> str:
    """Register a Gradio-style interactive page backed by a single Python function.

    Compiles directly to ``@aiui.page`` + ``@aiui.register_page_action`` +
    ``aiui.form``. Supports sync functions, ``async def`` functions, and
    streaming sync/async generators (``yield``).

    Returns the registered page ID.
    """
    from praisonaiui.server import register_page, register_page_action

    raw_inputs = [inputs] if isinstance(inputs, (str, Mapping)) else list(inputs)
    try:
        param_names = [
            p.name
            for p in inspect.signature(fn).parameters.values()
            if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
        ]
    except (TypeError, ValueError):
        param_names = []

    input_blocks = [
        _normalize_input(spec, idx, param_names[idx] if idx < len(param_names) else None)
        for idx, spec in enumerate(raw_inputs)
    ]
    page_id = id or _slugify(title)

    def _render(values: Mapping[str, Any] | None = None, output_blocks: Sequence[dict[str, Any]] = ()) -> dict[str, Any]:
        blocks: list[dict[str, Any]] = []
        if description:
            blocks.append(ui.caption(description))
        blocks.append(
            ui.form(
                page_id,
                submit_label=submit_label,
                children=_hydrate_inputs(input_blocks, values or {}),
            )
        )
        if output_blocks:
            blocks.append(ui.divider("Output"))
            blocks.extend(output_blocks)
        return ui.layout(blocks)

    async def _page_handler() -> dict[str, Any]:
        return _render()

    def _action_handler(data: dict[str, Any]) -> Any:
        result = _invoke(fn, input_blocks, data)
        if inspect.isasyncgen(result):

            async def _stream_async():
                async for frame in result:
                    yield _render(data, _format_output(frame, outputs))

            return _stream_async()
        if inspect.isgenerator(result):

            async def _stream_sync():
                for frame in result:
                    yield _render(data, _format_output(frame, outputs))
                    await asyncio.sleep(0)

            return _stream_sync()
        if inspect.isawaitable(result):

            async def _await_one():
                return _render(data, _format_output(await result, outputs))

            return _await_one()
        return _render(data, _format_output(result, outputs))

    register_page(
        page_id,
        title=title,
        icon=icon,
        group=group,
        description=description,
        handler=_page_handler,
        order=order,
    )
    register_page_action(page_id)(_action_handler)
    return page_id
