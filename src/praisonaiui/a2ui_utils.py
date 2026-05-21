"""A2UI payload detection and normalisation for PraisonAIUI."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from praisonaiagents.ui.protocols import A2UI_MIME_TYPE

DEFAULT_SURFACE_ID = "main"
A2UI_VERSION = "v0.9"


def is_a2ui_tool_result(result: Any) -> bool:
    """Return True if *result* looks like an A2UI tool or A2A part payload."""
    if result is None:
        return False
    if isinstance(result, dict):
        mime = result.get("mime_type") or result.get("mimeType")
        if mime == A2UI_MIME_TYPE:
            return True
        if isinstance(result.get("messages"), list):
            return True
        if isinstance(result.get("a2ui_part"), (dict, list)):
            return True
    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, dict) and any(
            k in first for k in ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")
        ):
            return True
    return False


def _extract_raw_messages(result: Any) -> List[Dict[str, Any]]:
    """Pull the message list from various A2UI result shapes."""
    if isinstance(result, list):
        return [m for m in result if isinstance(m, dict)]
    if not isinstance(result, dict):
        return []

    for key in ("messages", "a2ui_part"):
        val = result.get(key)
        if isinstance(val, list):
            return [m for m in val if isinstance(m, dict)]
        if isinstance(val, dict) and isinstance(val.get("messages"), list):
            return [m for m in val["messages"] if isinstance(m, dict)]

    if any(k in result for k in ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")):
        return [result]
    return []


def coerce_a2ui_tool_messages(raw: Any, *, surface_id: str = DEFAULT_SURFACE_ID) -> List[Dict[str, Any]]:
    """Coerce common LLM tool-arg shapes into a valid A2UI message list."""
    if raw is None:
        raise ValueError("messages must be a list of A2UI message dicts or a JSON string")

    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"messages JSON string is not valid JSON: {exc}") from exc

    if isinstance(raw, dict):
        if isinstance(raw.get("messages"), list):
            raw = raw["messages"]
        elif "components" in raw:
            raw = [{"updateComponents": {"components": raw["components"]}}]
        elif any(k in raw for k in ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")):
            raw = [raw]
        elif raw.get("component"):
            raw = [{"updateComponents": {"components": [raw]}}]
        else:
            raise ValueError("messages must be a list of A2UI message dicts or a JSON string")

    if not isinstance(raw, list):
        raise ValueError("messages must be a list of A2UI message dicts or a JSON string")

    items = [dict(m) for m in raw if isinstance(m, dict)]
    if not items:
        raise ValueError("messages must contain at least one A2UI message dict")

    if not any(m.get("createSurface") for m in items):
        items.insert(0, {"createSurface": {"surfaceId": surface_id, "catalogId": "basic"}})

    return normalise_a2ui_messages({"messages": items})


def normalise_a2ui_messages(result: Any) -> List[Dict[str, Any]]:
    """Normalise A2UI messages — ensure version field and list shape."""
    raw = _extract_raw_messages(result)
    out: List[Dict[str, Any]] = []
    for msg in raw:
        item = dict(msg)
        if "version" not in item:
            item["version"] = A2UI_VERSION
        out.append(item)
    return out


def infer_surface_id(result: Any, messages: Optional[List[Dict[str, Any]]] = None) -> str:
    """Infer surface id from createSurface message or result dict."""
    msgs = messages if messages is not None else normalise_a2ui_messages(result)
    for msg in msgs:
        create = msg.get("createSurface")
        if isinstance(create, dict):
            sid = create.get("surfaceId") or create.get("id")
            if sid:
                return str(sid)
    if isinstance(result, dict):
        sid = result.get("surface_id") or result.get("surfaceId")
        if sid:
            return str(sid)
    return DEFAULT_SURFACE_ID


def build_a2ui_extra(result: Any) -> Optional[Dict[str, Any]]:
    """Build extra_data dict for RunEvent when result is A2UI."""
    if not is_a2ui_tool_result(result):
        return None
    messages = normalise_a2ui_messages(result)
    if not messages:
        return None
    surface_id = infer_surface_id(result, messages)
    return {"a2ui": messages, "surface_id": surface_id}


def tool_completed_extra(result: Any, *, has_complete_args: bool = True) -> Dict[str, Any]:
    """Merge standard tool-completion flags with optional A2UI and media payloads."""
    extra: Dict[str, Any] = {}
    if has_complete_args:
        extra["has_complete_args"] = True
    try:
        from praisonaiui.media_utils import build_media_extra

        media = build_media_extra(result)
        if media:
            extra.update(media)
    except ImportError:
        pass
    a2ui_extra = build_a2ui_extra(result)
    if a2ui_extra:
        extra.update(a2ui_extra)
    return extra
