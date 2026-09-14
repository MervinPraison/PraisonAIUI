"""Build PraisonAIUI components for the call detail page."""

from __future__ import annotations

from typing import Any

import praisonaiui as aiui


def build_call_detail_layout(record: dict[str, Any]) -> dict[str, Any]:
    """Return dashboard component tree for call detail (code_block + metadata)."""
    from integrations.voice.call_finalize import analytics_for_record

    metadata = record.get("metadata") or {}
    analytics = analytics_for_record(record)
    transcript = (record.get("transcript") or "").strip() or "(empty — waiting for speech…)"
    summary = (record.get("summary") or "").strip() or "(not available yet)"
    status = str(record.get("status") or "unknown")

    kv_items: list[dict[str, str]] = [
        {"label": "Call ID", "value": str(record.get("call_id") or "—")},
        {"label": "Status", "value": status},
        {"label": "Customer", "value": str(record.get("customer_number") or "—")},
    ]
    if metadata.get("user_id"):
        kv_items.append({"label": "User ID", "value": str(metadata["user_id"])})
    if metadata.get("praison_session_id"):
        kv_items.append({"label": "Memory session", "value": str(metadata["praison_session_id"])})
    kv_items.append({"label": "Duration", "value": str(analytics.get("duration") or "—")})
    kv_items.append({"label": "Turns", "value": str(analytics.get("turn_count") or 0)})

    return aiui.layout(
        [
            aiui.text("Live voice call transcript and metadata"),
            aiui.badge(status, variant="default"),
            aiui.definition_list(kv_items, title="Call metadata"),
            aiui.alert(
                "Transcript updates live via SSE. Final lines use PraisonAIUI code blocks.",
                variant="info",
                title="Live feed",
            ),
            aiui.tabs(
                [
                    {
                        "label": "Transcript",
                        "children": [
                            aiui.code_block(transcript, language="text"),
                        ],
                    },
                    {
                        "label": "Summary",
                        "children": [aiui.text(summary)],
                    },
                ]
            ),
        ]
    )
