"""Media payload detection and normalisation for PraisonAIUI chat."""

from __future__ import annotations

import base64
import re
from typing import Any, Dict, List, Optional

MEDIA_ELEMENT_TYPES = frozenset({"image", "pdf", "video", "audio", "file"})
_IMAGE_URL_RE = re.compile(
    r"^https?://[^\s]+\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?[^\s]*)?$",
    re.IGNORECASE,
)
_DATA_IMAGE_RE = re.compile(r"^data:image/[^;]+;base64,", re.IGNORECASE)


def media_serve_url(attachment_id: str) -> str:
    """Public URL for a stored generated-media attachment."""
    return f"/api/chat/media/{attachment_id}"


def _store_b64_image(b64_json: str, session_id: str = "") -> str:
    """Persist base64 image bytes and return a stable serve URL."""
    from praisonaiui.features.attachments import get_attachment_manager

    raw = base64.b64decode(b64_json, validate=True)
    mgr = get_attachment_manager()
    meta = mgr.upload(
        data=raw,
        filename="generated.png",
        content_type="image/png",
        session_id=session_id,
    )
    return media_serve_url(meta["id"])


def _image_element(
    *,
    url: Optional[str] = None,
    b64_json: Optional[str] = None,
    alt: str = "",
    persist_b64: bool = True,
    session_id: str = "",
) -> Optional[Dict[str, Any]]:
    if url:
        return {"type": "image", "url": url, "alt": alt or "Generated image"}
    if b64_json:
        if persist_b64:
            try:
                url = _store_b64_image(b64_json, session_id=session_id)
                return {"type": "image", "url": url, "alt": alt or "Generated image"}
            except Exception:
                pass
        return {
            "type": "image",
            "url": f"data:image/png;base64,{b64_json}",
            "alt": alt or "Generated image",
        }
    return None


def _item_to_element(
    item: Any,
    *,
    persist_b64: bool = True,
    session_id: str = "",
) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None

    el_type = item.get("type")
    if el_type in MEDIA_ELEMENT_TYPES and item.get("url"):
        return dict(item)

    url = item.get("url")
    b64 = item.get("b64_json")
    alt = item.get("alt") or item.get("revised_prompt") or item.get("name") or ""
    if url or b64:
        return _image_element(
            url=url,
            b64_json=b64,
            alt=str(alt) if alt else "",
            persist_b64=persist_b64,
            session_id=session_id,
        )
    return None


def _openai_data_list(result: dict) -> List[Any]:
    data = result.get("data")
    if isinstance(data, list):
        return data
    return []


def extract_media_elements(
    result: Any,
    *,
    persist_b64: bool = True,
    session_id: str = "",
) -> List[Dict[str, Any]]:
    """Normalise backend-specific media payloads into message element dicts."""
    if result is None:
        return []

    if isinstance(result, str):
        text = result.strip()
        if _DATA_IMAGE_RE.match(text) or _IMAGE_URL_RE.match(text):
            return [{"type": "image", "url": text, "alt": "Image"}]
        return []

    if isinstance(result, dict):
        if result.get("type") in MEDIA_ELEMENT_TYPES and result.get("url"):
            return [dict(result)]

        elements: List[Dict[str, Any]] = []
        for item in _openai_data_list(result):
            el = _item_to_element(
                item, persist_b64=persist_b64, session_id=session_id
            )
            if el:
                elements.append(el)
        if elements:
            return elements

        el = _item_to_element(result, persist_b64=persist_b64, session_id=session_id)
        if el:
            return [el]

        nested = result.get("elements")
        if isinstance(nested, list):
            out: List[Dict[str, Any]] = []
            for item in nested:
                if isinstance(item, dict) and item.get("type") in MEDIA_ELEMENT_TYPES:
                    out.append(dict(item))
            if out:
                return out
        return []

    if isinstance(result, list):
        out: List[Dict[str, Any]] = []
        for item in result:
            if isinstance(item, dict) and item.get("type") in MEDIA_ELEMENT_TYPES:
                out.append(dict(item))
                continue
            el = _item_to_element(item, persist_b64=persist_b64, session_id=session_id)
            if el:
                out.append(el)
        return out

    # ImageResult-like objects from praisonai capabilities
    url = getattr(result, "url", None)
    b64 = getattr(result, "b64_json", None)
    if url or b64:
        el = _image_element(
            url=url,
            b64_json=b64,
            alt=getattr(result, "revised_prompt", "") or "",
            persist_b64=persist_b64,
            session_id=session_id,
        )
        return [el] if el else []

    return []


def is_media_tool_result(result: Any) -> bool:
    """Return True if *result* contains displayable media elements."""
    return bool(extract_media_elements(result, persist_b64=False))


def build_media_extra(
    result: Any,
    *,
    persist_b64: bool = True,
    session_id: str = "",
) -> Optional[Dict[str, Any]]:
    """Build extra_data dict for RunEvent when result carries media."""
    elements = extract_media_elements(
        result, persist_b64=persist_b64, session_id=session_id
    )
    if not elements:
        return None
    return {"elements": elements}


def queue_event_to_element(event: dict) -> Optional[Dict[str, Any]]:
    """Map legacy callback queue events (image/video/…) to element dicts."""
    evt_type = event.get("type")
    url = event.get("url", "")
    if not url and evt_type != "code":
        return None

    if evt_type == "image":
        return {"type": "image", "url": url, "alt": event.get("alt", "")}
    if evt_type == "video":
        return {"type": "video", "url": url, "name": event.get("name", "")}
    if evt_type == "audio":
        return {"type": "audio", "url": url, "name": event.get("name", "")}
    if evt_type == "file":
        return {"type": "file", "url": url, "name": event.get("name", "")}
    return None
