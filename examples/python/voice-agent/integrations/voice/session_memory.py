"""Cross-call voice memory via PraisonAI session reload by stable user ID."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_CALL_USER: dict[str, str] = {}


def memory_enabled() -> bool:
    return os.getenv("VOICE_MEMORY_ENABLED", "true").lower() in ("1", "true", "yes")


def voice_user_session_id(user_id: str) -> str:
    clean = str(user_id or "").strip()
    if not clean:
        raise ValueError("user_id required")
    return f"voice-user-{clean}"


def attach_pending_user(user_id: str) -> None:
    from integrations.voice.store import VoiceCallStore

    clean = str(user_id or "").strip()
    if clean:
        VoiceCallStore.set_pending_user(clean)


def consume_pending_user() -> str | None:
    from integrations.voice.store import VoiceCallStore

    return VoiceCallStore.consume_pending_user()


def bind_call_user(call_id: str, user_id: str) -> str:
    """Associate a provider call/conversation id with a stable browser user id."""
    from integrations.voice.store import VoiceCallStore

    call_id = str(call_id or "").strip()
    user_id = str(user_id or "").strip()
    if not call_id or not user_id:
        raise ValueError("call_id and user_id required")
    session_id = voice_user_session_id(user_id)
    _CALL_USER[call_id] = user_id
    VoiceCallStore.upsert_call(
        call_id,
        metadata={"user_id": user_id, "praison_session_id": session_id},
    )
    return session_id


def resolve_call_user(call_id: str | None) -> str | None:
    if not call_id:
        return None
    if call_id in _CALL_USER:
        return _CALL_USER[call_id]
    from integrations.voice.store import VoiceCallStore

    record = VoiceCallStore.get_call(call_id)
    if not record:
        return None
    user_id = (record.get("metadata") or {}).get("user_id")
    if user_id:
        _CALL_USER[call_id] = str(user_id)
    return str(user_id) if user_id else None


def resolve_praison_session_id(call_id: str | None) -> str | None:
    user_id = resolve_call_user(call_id)
    if not user_id:
        return None
    return voice_user_session_id(user_id)


def _history_limit() -> int:
    try:
        return max(1, int(os.getenv("VOICE_MEMORY_HISTORY_LIMIT", "20")))
    except ValueError:
        return 20


def load_session_history(session_id: str) -> list[dict[str, str]]:
    """Load prior turns from PraisonAI DefaultSessionStore."""
    try:
        from praisonaiagents.session.store import DefaultSessionStore

        store = DefaultSessionStore()
        return store.get_chat_history(session_id, max_messages=_history_limit())
    except Exception:  # noqa: BLE001
        logger.debug("Failed to load session history for %s", session_id, exc_info=True)
        return []


def append_session_turn(session_id: str, role: str, content: str) -> None:
    """Persist one voice turn into the PraisonAI session folder."""
    text = str(content or "").strip()
    if not session_id or not text:
        return
    try:
        from praisonaiagents.session.store import DefaultSessionStore

        store = DefaultSessionStore()
        if role == "user":
            store.add_user_message(session_id, text, metadata={"platform": "voice"})
        else:
            store.add_assistant_message(session_id, text, metadata={"platform": "voice"})
    except Exception:  # noqa: BLE001
        logger.debug("Failed to append session turn for %s", session_id, exc_info=True)


async def ensure_ui_session(session_id: str, *, user_id: str | None = None, call_id: str | None = None) -> None:
    """Ensure PraisonAIUI datastore session exists for sidebar reload."""
    try:
        from praisonaiui.server import _datastore
    except Exception:  # noqa: BLE001
        return
    existing = await _datastore.get_session(session_id)
    title = "Voice memory"
    if call_id:
        title = f"Voice user {user_id or call_id[:8]}"
    if existing is None:
        await _datastore.create_session(session_id)
        await _datastore.update_session(
            session_id,
            platform="voice",
            icon="🎙️",
            title=title,
        )


async def append_ui_message(session_id: str, role: str, content: str) -> None:
    try:
        from praisonaiui.server import _datastore

        await _datastore.add_message(
            session_id,
            {"role": "user" if role == "user" else "assistant", "content": content, "platform": "voice"},
        )
    except Exception:  # noqa: BLE001
        logger.debug("Failed to append UI message for %s", session_id, exc_info=True)


def _apply_knowledge_augmentation(prompt: str) -> str:
    from praisonaiui.features.knowledge import get_knowledge_manager

    k_mgr = get_knowledge_manager()
    if not k_mgr.list_all():
        return prompt
    results = k_mgr.search(prompt, limit=5)
    lines = [r.get("text", "") for r in results if r.get("text")]
    if not lines:
        return prompt
    block = "\n".join(lines)
    return f"[Knowledge Context]\n{block}\n[/Knowledge Context]\n\n{prompt}"


def build_knowledge_augmented_prompt(prompt: str, *, timeout_s: float | None = 2.0) -> str:
    """Inject knowledge search results like dashboard chat run_agent().

    Knowledge indexing can take tens of seconds on cold start; Speech Engine
    disconnects if the LLM path blocks too long, so callers use a short timeout.
    """
    if not os.getenv("VOICE_MEMORY_USE_KNOWLEDGE", "true").lower() in ("1", "true", "yes"):
        return prompt
    try:
        if timeout_s is None:
            return _apply_knowledge_augmentation(prompt)
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_apply_knowledge_augmentation, prompt)
            return future.result(timeout=timeout_s)
    except FuturesTimeoutError:
        logger.warning("Knowledge augmentation timed out after %.1fs; using plain prompt", timeout_s)
        return prompt
    except Exception:  # noqa: BLE001
        logger.debug("Knowledge augmentation skipped", exc_info=True)
        return prompt


def history_context_block(session_id: str | None) -> str:
    if not memory_enabled() or not session_id:
        return ""
    history = load_session_history(session_id)
    if not history:
        return ""
    lines = []
    for item in history[-_history_limit() :]:
        role = item.get("role", "user")
        content = str(item.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content}")
    if not lines:
        return ""
    return "Previous conversation with this user:\n" + "\n".join(lines)


def openai_messages_with_memory(
    transcript_lines: list[str],
    *,
    session_id: str | None,
    base_instructions: str,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": base_instructions}]
    prior = history_context_block(session_id)
    if prior:
        messages.append({"role": "system", "content": prior})
    for line in transcript_lines:
        if line.startswith("user:"):
            messages.append({"role": "user", "content": line[5:].strip()})
        elif line.startswith("agent:"):
            messages.append({"role": "assistant", "content": line[6:].strip()})
    return messages


def bind_call_from_pending(call_id: str) -> str | None:
    user_id = consume_pending_user()
    if not user_id:
        return None
    return bind_call_user(call_id, user_id)


async def record_voice_turn(
    call_id: str | None,
    *,
    user_text: str | None = None,
    agent_text: str | None = None,
) -> None:
    """Save latest user/agent lines to Praison session + chat UI."""
    session_id = resolve_praison_session_id(call_id)
    if not session_id:
        return
    user_id = resolve_call_user(call_id)
    await ensure_ui_session(session_id, user_id=user_id, call_id=call_id)
    if user_text:
        append_session_turn(session_id, "user", user_text)
        await append_ui_message(session_id, "user", user_text)
    if agent_text:
        append_session_turn(session_id, "assistant", agent_text)
        await append_ui_message(session_id, "assistant", agent_text)


def instructions_with_memory(base: str, *, session_id: str | None) -> str:
    prior = history_context_block(session_id)
    if not prior:
        return base
    return f"{base}\n\n{prior}\nUse prior conversation when the user refers to earlier calls."
