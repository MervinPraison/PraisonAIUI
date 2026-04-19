"""Component schema registry — opt-in JSON Schema contracts.

This closes the typed-contract gap documented in
``docs/features/how-to-add-a-feature.md``.

Design goals (agent-centric, minimal API):
  - Opt-in: unregistered component types continue to work unchanged.
  - Auto-coverage: every ``praisonaiui.ui.*`` builder contributes a
    minimal built-in schema, so the registry is non-empty on first use.
  - DRY: built-ins are introspected from ``ui.py`` once per process; user
    schemas can be layered on top and take priority.
  - Performance: built-in schemas are generated lazily.

Public API:
  - ``register_component_schema(component_type, schema)``
  - ``get_component_schemas()``
  - ``reset_component_schemas()``
"""

from __future__ import annotations

import inspect
import re
from typing import Any

# User-registered schemas (set via aiui.register_component_schema)
_user_schemas: dict[str, dict[str, Any]] = {}

# Built-in schemas derived from ui.py; populated lazily
_builtin_schemas: dict[str, dict[str, Any]] | None = None


def register_component_schema(component_type: str, schema: dict[str, Any]) -> None:
    """Register a JSON Schema for a custom component ``type``.

    The schema describes the shape of the component dict (i.e. the
    payload returned by Python builders like ``aiui.card(...)``).

    User-registered schemas take priority over built-ins: if you register
    ``"card"`` with a custom schema, your version is returned from
    :func:`get_component_schemas`.

    Args:
        component_type: Component type string, e.g. ``"timeline"``.
        schema: JSON Schema dict. Any valid Draft 2020-12 schema is OK.

    Example::

        aiui.register_component_schema("timeline", {
            "type": "object",
            "required": ["type", "events"],
            "properties": {
                "type": {"const": "timeline"},
                "events": {"type": "array"},
            },
        })
    """
    _user_schemas[component_type] = schema


def get_component_schemas() -> dict[str, dict[str, Any]]:
    """Return the merged schema registry (built-in + user)."""
    builtins = _get_builtin_schemas()
    # User schemas override built-ins
    return {**builtins, **_user_schemas}


def reset_component_schemas() -> None:
    """Clear user-registered schemas. Built-ins are preserved."""
    _user_schemas.clear()


# ── Built-in schema discovery ──────────────────────────────────────

_TYPE_RE = re.compile(r'"type":\s*"(\w+)"')


def _get_builtin_schemas() -> dict[str, dict[str, Any]]:
    """Lazily derive minimal schemas from ``praisonaiui.ui`` builders.

    For each type string found in ``ui.py``, we emit a schema that:
      - Requires ``type`` with that constant value.
      - Includes ``properties`` inferred from the builder's keyword
        parameters (best-effort; falls back to a free-form object).
    """
    global _builtin_schemas
    if _builtin_schemas is not None:
        return _builtin_schemas

    from praisonaiui import ui as _ui

    source = inspect.getsource(_ui)
    types = set(_TYPE_RE.findall(source))

    # Map each type back to the builder function that emits it. We
    # look for the nearest `def <name>(` above each `"type": "<type>"`.
    type_to_builder: dict[str, str] = {}
    fn_def_re = re.compile(r"^def\s+(\w+)\s*\(", re.MULTILINE)
    fn_positions = [(m.group(1), m.start()) for m in fn_def_re.finditer(source)]
    for m in _TYPE_RE.finditer(source):
        pos = m.start()
        # Find the function def whose start is the largest <= pos
        candidate = None
        for fname, fpos in fn_positions:
            if fpos <= pos:
                candidate = fname
            else:
                break
        if candidate:
            type_to_builder.setdefault(m.group(1), candidate)

    schemas: dict[str, dict[str, Any]] = {}
    for t in types:
        schemas[t] = _builder_schema(t, type_to_builder.get(t), _ui)
    _builtin_schemas = schemas
    return _builtin_schemas


def _builder_schema(t: str, builder_name: str | None, ui_module: Any) -> dict[str, Any]:
    """Derive a JSON Schema from the builder's signature."""
    props: dict[str, Any] = {"type": {"const": t}}
    required = ["type"]
    if builder_name and hasattr(ui_module, builder_name):
        fn = getattr(ui_module, builder_name)
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            sig = None
        if sig is not None:
            for pname, pparam in sig.parameters.items():
                if pname == "self":
                    continue
                # Skip variadic
                if pparam.kind in (
                    inspect.Parameter.VAR_POSITIONAL,
                    inspect.Parameter.VAR_KEYWORD,
                ):
                    continue
                props[pname] = _annotation_to_schema(pparam.annotation)
                if pparam.default is inspect.Parameter.empty:
                    required.append(pname)
    return {
        "type": "object",
        "required": required,
        "properties": props,
        "additionalProperties": True,
    }


def _annotation_to_schema(annotation: Any) -> dict[str, Any]:
    """Map a Python type annotation to a minimal JSON Schema fragment."""
    if annotation is inspect.Parameter.empty:
        return {}
    s = str(annotation).lower()
    # Ordered from most specific to least
    if "dict" in s:
        return {"type": "object"}
    if "sequence" in s or "list" in s or "tuple" in s:
        return {"type": "array"}
    if "bool" in s:
        return {"type": "boolean"}
    if "int" in s and "float" not in s:
        return {"type": "integer"}
    if "float" in s or "int | float" in s:
        return {"type": "number"}
    if "str" in s:
        return {"type": "string"}
    return {}
