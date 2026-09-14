"""Process voice provider webhook events."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from integrations.voice.agent_runner import build_assistant_request_response, execute_voice_tool
from integrations.voice.config import VoiceSettings
from integrations.voice.live import transcript_hub
from integrations.voice.store import VoiceCallStore, webhook_event_key

logger = logging.getLogger(__name__)


def _message(payload: dict[str, Any]) -> dict[str, Any]:
    msg = payload.get("message")
    return msg if isinstance(msg, dict) else payload


def _call_id(payload: dict[str, Any]) -> str | None:
    msg = _message(payload)
    call = msg.get("call")
    if isinstance(call, dict) and call.get("id"):
        return str(call["id"])
    return None


def _customer_number(payload: dict[str, Any]) -> str | None:
    msg = _message(payload)
    call = msg.get("call") if isinstance(msg.get("call"), dict) else {}
    customer = call.get("customer") if isinstance(call, dict) else {}
    if isinstance(customer, dict) and customer.get("number"):
        return str(customer["number"])
    return None


def _tool_parameters(item: dict[str, Any]) -> dict[str, Any]:
    """Extract tool params from provider payloads (parameters or arguments)."""
    for key in ("parameters", "arguments"):
        value = item.get(key)
        if isinstance(value, dict):
            return value
    fn = item.get("function")
    if isinstance(fn, dict):
        for key in ("parameters", "arguments"):
            value = fn.get(key)
            if isinstance(value, dict):
                return value
    return {}


def _spoken_tool_result(raw: str) -> str:
    """Return plain spoken text for the voice pipeline (no newlines)."""
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            spoken = data.get("spoken") or data.get("message")
            if spoken:
                return str(spoken).replace("\n", " ").strip()
    except json.JSONDecodeError:
        pass
    return str(raw).replace("\n", " ").strip()


def process_voice_webhook(
    event_type: str, payload: dict[str, Any], *, settings: VoiceSettings
) -> dict[str, Any] | None:
    """Handle a verified provider webhook POST. Returns response body when required."""
    event_key = webhook_event_key(event_type, payload)
    if event_type not in ("tool-calls", "assistant-request", "transfer-destination-request", "knowledge-base-request"):
        if not VoiceCallStore.mark_event_processed(event_key, event_type):
            logger.info("Skipping duplicate voice event %s", event_type)
            return None

    msg = _message(payload)
    call_id = _call_id(payload)

    if event_type == "assistant-request":
        return build_assistant_request_response(settings)

    if event_type == "tool-calls" and call_id:
        tool_calls = msg.get("toolCallList") or []
        if not tool_calls and isinstance(msg.get("toolWithToolCallList"), list):
            for entry in msg["toolWithToolCallList"]:
                if not isinstance(entry, dict):
                    continue
                tool_call = entry.get("toolCall")
                if isinstance(tool_call, dict):
                    tool_calls.append(
                        {
                            "id": tool_call.get("id"),
                            "name": entry.get("name") or (tool_call.get("function") or {}).get("name"),
                            "parameters": _tool_parameters(tool_call),
                            "arguments": _tool_parameters(tool_call),
                        }
                    )
        results = []
        for item in tool_calls:
            if not isinstance(item, dict):
                continue
            tool_call_id = str(item.get("id") or "")
            name = str(item.get("name") or "")
            if not name:
                fn = item.get("function")
                if isinstance(fn, dict):
                    name = str(fn.get("name") or "")
            params = _tool_parameters(item)
            result = _spoken_tool_result(execute_voice_tool(name, params))
            results.append({"toolCallId": tool_call_id, "name": name, "result": result})
        VoiceCallStore.upsert_call(call_id, status="in-progress", customer_number=_customer_number(payload))
        return {"results": results}

    if event_type == "status-update" and call_id:
        status = str(msg.get("status") or "unknown")
        VoiceCallStore.upsert_call(call_id, status=status, customer_number=_customer_number(payload))
        return None

    if event_type == "transcript" and call_id:
        role = str(msg.get("role") or "unknown")
        text = str(msg.get("transcript") or "").strip()
        kind = str(msg.get("transcriptType") or "final")
        if text:
            line = f"{role}: {text}"
            if kind == "final":
                VoiceCallStore.append_transcript_line(call_id, line)
            else:
                VoiceCallStore.upsert_call(
                    call_id,
                    status="in-progress",
                    customer_number=_customer_number(payload),
                    metadata={"partial_transcript": line},
                )
            transcript_hub.publish(
                call_id,
                {"type": "transcript", "role": role, "text": text, "transcriptType": kind},
            )
            from integrations.voice.chat_bridge import enqueue_transcript

            enqueue_transcript(call_id, role, text, final=kind == "final")
        return None

    if event_type == "end-of-call-report" and call_id:
        artifact = msg.get("artifact") if isinstance(msg.get("artifact"), dict) else {}
        transcript = artifact.get("transcript") if isinstance(artifact, dict) else None
        summary = str(msg.get("summary") or "")
        ended = str(msg.get("endedReason") or "ended")
        VoiceCallStore.upsert_call(
            call_id,
            status=f"ended ({ended})",
            customer_number=_customer_number(payload),
            transcript=str(transcript) if transcript else None,
            summary=summary or None,
            metadata={"artifact": artifact},
        )
        from integrations.voice.call_finalize import finalize_call

        asyncio.run(finalize_call(call_id, status=f"ended ({ended})"))
        return None

    if event_type == "conversation-update" and call_id:
        messages = msg.get("messages") or []
        lines = []
        for item in messages:
            if not isinstance(item, dict):
                continue
            role = item.get("role") or "unknown"
            text = item.get("message") or item.get("content") or ""
            if text:
                lines.append(f"{role}: {text}")
        if lines:
            VoiceCallStore.upsert_call(
                call_id, transcript="\n".join(lines), customer_number=_customer_number(payload)
            )
        return None

    logger.debug("Unhandled voice event %s: %s", event_type, json.dumps(payload)[:300])
    return None
