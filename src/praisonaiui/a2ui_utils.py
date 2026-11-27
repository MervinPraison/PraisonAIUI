"""A2UI payload detection, v0.8/v0.9/v0.10 normalisation, and builders for PraisonAIUI."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

try:
    from praisonaiagents.ui.protocols import A2UI_MIME_TYPE
except ImportError:
    A2UI_MIME_TYPE = "application/json+a2ui"

DEFAULT_SURFACE_ID = "main"
A2UI_VERSION = "v0.9"
A2UI_SUPPORTED_VERSIONS: tuple[str, ...] = ("v0.8", "v0.9", "v0.10")

A2UI_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json"
A2UI_BASIC_CATALOG_V09_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
A2UI_BASIC_CATALOG_V010_ID = "https://a2ui.org/specification/v0_10/catalogs/basic/catalog.json"
A2UI_STANDARD_CATALOG_V08_ID = "https://a2ui.org/specification/v0_8/standard_catalog_definition.json"

A2UI_CATALOG_IDS: tuple[str, ...] = (
    A2UI_BASIC_CATALOG_V09_ID,
    A2UI_BASIC_CATALOG_ID,
    A2UI_BASIC_CATALOG_V010_ID,
    A2UI_STANDARD_CATALOG_V08_ID,
)

# All 18 standard Basic Catalog components (A2UI v0.9 / v0.10)
A2UI_BASIC_COMPONENTS: tuple[str, ...] = (
    "Text",
    "Image",
    "Icon",
    "Video",
    "AudioPlayer",
    "Row",
    "Column",
    "List",
    "Card",
    "Tabs",
    "Modal",
    "Divider",
    "Button",
    "TextField",
    "CheckBox",
    "ChoicePicker",
    "Slider",
    "DateTimeInput",
)

# All 14 standard Basic Catalog client-side functions (A2UI v0.9 / v0.10)
A2UI_BASIC_FUNCTIONS: tuple[str, ...] = (
    "required",
    "regex",
    "length",
    "numeric",
    "email",
    "formatString",
    "formatNumber",
    "formatCurrency",
    "formatDate",
    "pluralize",
    "openUrl",
    "and",
    "or",
    "not",
)

_V09_MSG_KEYS = ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")
_V08_MSG_KEYS = ("beginRendering", "surfaceUpdate", "dataModelUpdate")
_ALL_MSG_KEYS = _V09_MSG_KEYS + _V08_MSG_KEYS


def a2ui_client_capabilities() -> Dict[str, Any]:
    """Return standard A2UI client capability metadata for agent negotiation."""
    return {
        "version": A2UI_VERSION,
        "supportedVersions": list(A2UI_SUPPORTED_VERSIONS),
        "mimeType": A2UI_MIME_TYPE,
        "a2uiClientCapabilities": {
            "v0.9": {
                "supportedCatalogIds": [
                    A2UI_BASIC_CATALOG_V09_ID,
                    A2UI_BASIC_CATALOG_ID,
                ],
                "inlineCatalogs": [],
            },
            "v0.10": {
                "supportedCatalogIds": [A2UI_BASIC_CATALOG_V010_ID],
                "inlineCatalogs": [],
            },
            "v0.8": {
                "supportedCatalogIds": [A2UI_STANDARD_CATALOG_V08_ID],
            },
        },
        "components": list(A2UI_BASIC_COMPONENTS),
        "functions": list(A2UI_BASIC_FUNCTIONS),
        "features": {
            "jsonl": True,
            "dataBinding": True,
            "sendDataModel": True,
            "multiSurface": True,
            "customRenderers": True,
            "theme": True,
        },
    }


# ── Builders (v0.9) ───────────────────────────────────────────────────────────


def a2ui_create_surface(
    surface_id: str = DEFAULT_SURFACE_ID,
    *,
    catalog_id: str = A2UI_BASIC_CATALOG_V09_ID,
    theme: Optional[Dict[str, Any]] = None,
    send_data_model: Optional[bool] = None,
    version: str = A2UI_VERSION,
) -> Dict[str, Any]:
    """Build an A2UI ``createSurface`` message."""
    body: Dict[str, Any] = {"surfaceId": surface_id, "catalogId": catalog_id}
    if theme:
        body["theme"] = dict(theme)
    if send_data_model is not None:
        body["sendDataModel"] = bool(send_data_model)
    return {"version": version, "createSurface": body}


def a2ui_update_components(
    components: List[Dict[str, Any]],
    *,
    surface_id: str = DEFAULT_SURFACE_ID,
    version: str = A2UI_VERSION,
) -> Dict[str, Any]:
    """Build an A2UI ``updateComponents`` message."""
    return {
        "version": version,
        "updateComponents": {
            "surfaceId": surface_id,
            "components": [dict(c) for c in components],
        },
    }


def a2ui_update_data_model(
    value: Any,
    *,
    path: str = "/",
    surface_id: str = DEFAULT_SURFACE_ID,
    version: str = A2UI_VERSION,
) -> Dict[str, Any]:
    """Build an A2UI ``updateDataModel`` message."""
    body: Dict[str, Any] = {"surfaceId": surface_id, "path": path, "value": value}
    return {"version": version, "updateDataModel": body}


def a2ui_delete_surface(
    surface_id: str = DEFAULT_SURFACE_ID,
    *,
    version: str = A2UI_VERSION,
) -> Dict[str, Any]:
    """Build an A2UI ``deleteSurface`` message."""
    return {"version": version, "deleteSurface": {"surfaceId": surface_id}}


def a2ui_surface(
    components: List[Dict[str, Any]],
    *,
    data: Optional[Dict[str, Any]] = None,
    surface_id: str = DEFAULT_SURFACE_ID,
    catalog_id: str = A2UI_BASIC_CATALOG_V09_ID,
    theme: Optional[Dict[str, Any]] = None,
    send_data_model: Optional[bool] = None,
    version: str = A2UI_VERSION,
) -> List[Dict[str, Any]]:
    """Build a complete A2UI message sequence (createSurface + updateComponents [+ updateDataModel])."""
    msgs: List[Dict[str, Any]] = [
        a2ui_create_surface(
            surface_id,
            catalog_id=catalog_id,
            theme=theme,
            send_data_model=send_data_model,
            version=version,
        ),
        a2ui_update_components(components, surface_id=surface_id, version=version),
    ]
    if data is not None:
        msgs.append(a2ui_update_data_model(data, path="/", surface_id=surface_id, version=version))
    return msgs


# ── v0.8 → v0.9 conversion ────────────────────────────────────────────────────


def _unwrap_v08_bound_value(val: Any) -> Any:
    """Convert v0.8 BoundValue dicts into v0.9 literal or path bindings."""
    if not isinstance(val, dict):
        return val
    if "path" in val and len(val) == 1:
        return val
    if "path" in val and any(
        k in val for k in ("literalString", "literalNumber", "literalBoolean", "literalArray")
    ):
        return {"path": val["path"]}
    for key in ("literalString", "literalNumber", "literalBoolean", "literalArray"):
        if key in val:
            return val[key]
    return val


def _convert_v08_component(comp: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a v0.8 component dict into flat v0.9 shape."""
    comp_id = comp.get("id")
    raw_comp = comp.get("component")
    if isinstance(raw_comp, dict) and len(raw_comp) == 1:
        comp_type, raw_props = next(iter(raw_comp.items()))
        props = dict(raw_props) if isinstance(raw_props, dict) else {}
    else:
        comp_type = raw_comp
        props = {k: v for k, v in comp.items() if k not in ("id", "component")}

    out: Dict[str, Any] = {}
    if comp_id is not None:
        out["id"] = comp_id
    if comp_type is not None:
        out["component"] = comp_type

    for k, v in props.items():
        if k == "usageHint":
            out["variant"] = v
        elif k == "distribution":
            out["justify"] = v
        elif k == "alignment":
            out["align"] = v
        elif k == "primary" and comp_type == "Button":
            if v:
                out.setdefault("variant", "primary")
        elif k == "children" and isinstance(v, dict):
            if isinstance(v.get("explicitList"), list):
                out["children"] = list(v["explicitList"])
            elif isinstance(v.get("template"), dict):
                tpl = v["template"]
                out["children"] = {
                    "componentId": tpl.get("componentId", ""),
                    "path": tpl.get("dataBinding") or tpl.get("path", ""),
                }
            else:
                out["children"] = v
        elif k == "action" and isinstance(v, dict):
            if "event" in v:
                out["action"] = v
            elif "name" in v:
                ctx = v.get("context")
                if isinstance(ctx, list):
                    ctx = {
                        item["key"]: _unwrap_v08_bound_value(item.get("value"))
                        for item in ctx
                        if isinstance(item, dict) and "key" in item
                    }
                out["action"] = {"event": {"name": v["name"], "context": ctx or {}}}
            else:
                out["action"] = v
        elif k == "text" and comp_type == "TextField" and "value" not in props:
            out["value"] = _unwrap_v08_bound_value(v)
        else:
            out[k] = _unwrap_v08_bound_value(v)
    return out


def _convert_v08_contents(contents: Any) -> Any:
    """Convert v0.8 dataModelUpdate contents list into a nested JSON dict."""
    if not isinstance(contents, list):
        return contents
    result: Dict[str, Any] = {}
    for entry in contents:
        if not isinstance(entry, dict) or "key" not in entry:
            continue
        key = str(entry["key"])
        if "valueString" in entry:
            result[key] = entry["valueString"]
        elif "valueNumber" in entry:
            result[key] = entry["valueNumber"]
        elif "valueBoolean" in entry:
            result[key] = entry["valueBoolean"]
        elif "valueMap" in entry:
            result[key] = _convert_v08_contents(entry["valueMap"])
        elif "value" in entry:
            result[key] = entry["value"]
    return result


def v08_to_v09(
    messages: List[Dict[str, Any]],
    *,
    surface_id: str = DEFAULT_SURFACE_ID,
) -> List[Dict[str, Any]]:
    """Upgrade A2UI v0.8 messages into v0.9 while preserving v0.9/v0.10 messages."""
    converted: List[Dict[str, Any]] = []
    root_alias: Dict[str, str] = {}
    saw_begin: List[Dict[str, Any]] = []

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if isinstance(msg.get("beginRendering"), dict):
            br = msg["beginRendering"]
            sid = str(br.get("surfaceId") or surface_id)
            root_id = br.get("root")
            if isinstance(root_id, str) and root_id and root_id != "root":
                root_alias[sid] = root_id
            create: Dict[str, Any] = {
                "surfaceId": sid,
                "catalogId": br.get("catalogId") or A2UI_BASIC_CATALOG_V09_ID,
            }
            if isinstance(br.get("styles"), dict):
                create["theme"] = dict(br["styles"])
            saw_begin.append({"version": A2UI_VERSION, "createSurface": create})
        elif isinstance(msg.get("surfaceUpdate"), dict):
            su = msg["surfaceUpdate"]
            sid = str(su.get("surfaceId") or surface_id)
            raw_comps = su.get("components") if isinstance(su.get("components"), list) else []
            comps = [_convert_v08_component(c) for c in raw_comps if isinstance(c, dict)]
            converted.append(
                {
                    "version": A2UI_VERSION,
                    "updateComponents": {"surfaceId": sid, "components": comps},
                }
            )
        elif isinstance(msg.get("dataModelUpdate"), dict):
            dmu = msg["dataModelUpdate"]
            sid = str(dmu.get("surfaceId") or surface_id)
            path = str(dmu.get("path") or "/")
            value = (
                _convert_v08_contents(dmu["contents"])
                if "contents" in dmu
                else dmu.get("value")
            )
            converted.append(
                {
                    "version": A2UI_VERSION,
                    "updateDataModel": {"surfaceId": sid, "path": path, "value": value},
                }
            )
        else:
            item = dict(msg)
            if "version" not in item:
                item["version"] = A2UI_VERSION
            converted.append(item)

    # In v0.8 beginRendering arrives last; in v0.9 createSurface must come first.
    if saw_begin:
        for msg in converted:
            uc = msg.get("updateComponents")
            if not isinstance(uc, dict):
                continue
            sid = str(uc.get("surfaceId") or surface_id)
            target_root = root_alias.get(sid)
            if not target_root:
                continue
            comps = uc.get("components", [])
            if not any(c.get("id") == "root" for c in comps if isinstance(c, dict)):
                for c in comps:
                    if isinstance(c, dict) and c.get("id") == target_root:
                        c["id"] = "root"
                        break
        converted = saw_begin + converted

    return converted


# ── Detection, parsing, and normalisation ─────────────────────────────────────


def parse_a2ui_jsonl(text: str) -> List[Dict[str, Any]]:
    """Parse an A2UI JSON or JSONL (newline-delimited JSON) string into message dicts."""
    stripped = text.strip()
    if not stripped:
        return []
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, list):
            return [m for m in parsed if isinstance(m, dict)]
        if isinstance(parsed, dict):
            if isinstance(parsed.get("messages"), list):
                return [m for m in parsed["messages"] if isinstance(m, dict)]
            return [parsed]
    except json.JSONDecodeError:
        pass

    out: List[Dict[str, Any]] = []
    for line in stripped.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        item = json.loads(line)
        if isinstance(item, dict):
            out.append(item)
    return out


def is_a2ui_tool_result(result: Any) -> bool:
    """Return True if *result* looks like an A2UI tool or A2A part payload (v0.8/v0.9/v0.10)."""
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
        if any(k in result for k in _ALL_MSG_KEYS):
            return True
    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, dict) and any(k in first for k in _ALL_MSG_KEYS):
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

    if any(k in result for k in _ALL_MSG_KEYS):
        return [result]
    return []


def coerce_a2ui_tool_messages(raw: Any, *, surface_id: str = DEFAULT_SURFACE_ID) -> List[Dict[str, Any]]:
    """Coerce common LLM tool-arg shapes (JSON, JSONL, v0.8, v0.9, v0.10) into valid A2UI messages."""
    if raw is None:
        raise ValueError("messages must be a list of A2UI message dicts or a JSON/JSONL string")

    if isinstance(raw, str):
        try:
            raw = parse_a2ui_jsonl(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"messages JSON string is not valid JSON: {exc}") from exc

    if isinstance(raw, dict):
        if isinstance(raw.get("messages"), list):
            raw = raw["messages"]
        elif "components" in raw:
            raw = [{"updateComponents": {"components": raw["components"]}}]
        elif any(k in raw for k in _ALL_MSG_KEYS):
            raw = [raw]
        elif raw.get("component"):
            raw = [{"updateComponents": {"components": [raw]}}]
        else:
            raise ValueError("messages must be a list of A2UI message dicts or a JSON/JSONL string")

    if not isinstance(raw, list):
        raise ValueError("messages must be a list of A2UI message dicts or a JSON/JSONL string")

    items = [dict(m) for m in raw if isinstance(m, dict)]
    if not items:
        raise ValueError("messages must contain at least one A2UI message dict")

    if any(any(k in m for k in _V08_MSG_KEYS) for m in items):
        items = v08_to_v09(items, surface_id=surface_id)

    if not any(m.get("createSurface") or m.get("deleteSurface") for m in items):
        items.insert(0, {"createSurface": {"surfaceId": surface_id, "catalogId": "basic"}})

    return normalise_a2ui_messages({"messages": items})


def normalise_a2ui_messages(result: Any) -> List[Dict[str, Any]]:
    """Normalise A2UI messages — upgrade v0.8 if present, ensure version field and list shape."""
    raw = _extract_raw_messages(result)
    if any(any(k in m for k in _V08_MSG_KEYS) for m in raw):
        raw = v08_to_v09(raw)
    out: List[Dict[str, Any]] = []
    for msg in raw:
        item = dict(msg)
        if "version" not in item:
            item["version"] = A2UI_VERSION
        out.append(item)
    return out


def infer_surface_id(result: Any, messages: Optional[List[Dict[str, Any]]] = None) -> str:
    """Infer surface id from createSurface/beginRendering/update messages or result dict."""
    msgs = messages if messages is not None else normalise_a2ui_messages(result)
    for msg in msgs:
        for key in _ALL_MSG_KEYS:
            block = msg.get(key)
            if isinstance(block, dict):
                sid = block.get("surfaceId") or block.get("id")
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
