"""Chat feature — protocol-driven real-time agent chat.

Gap 1–7 implementation:
  * ChatProtocol (interface any chat backend can implement)
  * ChatMessage (data model)
  * ChatManager (default implementation)
  * HTTP + WebSocket routes

Config-driven:
    Users configure agents via ``AIUIGateway.register_agent()``
    or ``praisonaiui.register_agent()``, and the chat UI appears automatically.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, Iterable, List, Optional, Set

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


def _collect_element(collected: List[Dict[str, Any]], element: Dict[str, Any]) -> None:
    """Append *element* unless the same URL is already collected."""
    if not element:
        return
    url = element.get("url")
    if url and any(e.get("url") == url for e in collected):
        return
    collected.append(element)


# Per-connection caps for WS session scoping (``subscribe`` and the sessions a
# client starts turns in). They bound memory if a client misbehaves.
MAX_SUBSCRIPTIONS_PER_CLIENT = 512
MAX_SESSION_ID_LENGTH = 256


def _clean_session_ids(session_ids: Any) -> List[str]:
    """Normalise a ``session_ids`` value from the wire to a list of ids.

    Accepts a list/tuple of strings or a single string; drops anything that is
    not a non-empty string of at most ``MAX_SESSION_ID_LENGTH`` characters.
    """
    if isinstance(session_ids, str):
        session_ids = [session_ids]
    if not isinstance(session_ids, (list, tuple, set, frozenset)):
        return []
    return [
        sid
        for sid in session_ids
        if isinstance(sid, str) and 0 < len(sid) <= MAX_SESSION_ID_LENGTH
    ]


def _paused_payload_fields(
    extra: Dict[str, Any],
    collected_tool_calls: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """Build the wire fields of a ``run_paused`` WS frame.

    Backward compatible: ``question``/``options`` stay at the top level for
    clients that only know the ask prompt (dashboard chat.js). ``extra_data``
    is forwarded as the provider sent it. For approval gates the approval
    fields are also lifted to the top level. ``type`` cannot be lifted (it is
    the event type, ``run_paused``), so the gate kind is exposed as
    ``pause_type`` and stays readable as ``extra_data.type``.

    When the provider did not know the gated call's ``tool_call_id``, it is
    inferred from the newest unfinished tool call of the same name in this
    run, so clients can attach the gate to the right tool card.
    """
    fields: Dict[str, Any] = {
        "question": extra.get("question", "The agent needs your input"),
        "options": extra.get("options", []),
        "extra_data": extra,
    }
    pause_type = extra.get("type") or "ask"
    fields["pause_type"] = pause_type
    if pause_type != "approval_required":
        return fields

    tool_call_id = extra.get("tool_call_id")
    tool_name = extra.get("tool_name")
    if not tool_call_id and tool_name:
        for tc in reversed(list(collected_tool_calls.values())):
            if tc.get("name") == tool_name and tc.get("status") != "done" and tc.get(
                "tool_call_id"
            ):
                tool_call_id = tc["tool_call_id"]
                break
    if tool_call_id and not extra.get("tool_call_id"):
        # Copy so the provider's own dict is never mutated.
        fields["extra_data"] = {**extra, "tool_call_id": tool_call_id}

    approval_id = extra.get("id")
    if approval_id is not None:
        fields["id"] = approval_id
        fields["approval_id"] = approval_id
    for key in ("tool_name", "arguments", "risk_level"):
        if key in extra:
            fields[key] = extra[key]
    if tool_call_id:
        fields["tool_call_id"] = tool_call_id
    return fields


# ── Tool display enrichment (reuses SDK's TOOL_LABELS — DRY) ────────


def _enrich_tool_payload(
    payload: Dict[str, Any],
    step_counter: int,
    is_completed: bool = False,
) -> Dict[str, Any]:
    """Add human-readable display metadata to a tool event payload.

    Reuses TOOL_LABELS and formatting from praisonaiagents.output.editor
    so both CLI and AIUI share a single source of truth.
    """
    name = payload.get("name") or ""
    args = payload.get("args")
    result = payload.get("result")

    try:
        from praisonaiagents.output.editor import TOOL_LABELS, EditorOutput

        icon, label = TOOL_LABELS.get(name, ("🔧", f"Using {name}"))
    except ImportError:
        icon, label = ("🔧", f"Using {name}")

    # Format action description (reuse SDK's static method)
    if not is_completed:
        try:
            from praisonaiagents.output.editor import EditorOutput

            desc = EditorOutput._format_action("", icon, label, args)
        except (ImportError, AttributeError):
            desc = f"{icon} {label}"
            if args:
                for key in ("query", "filepath", "file_path", "directory", "command"):
                    if key in args:
                        val = args[key]
                        desc = (
                            f'{icon} {label} for "{val}"'
                            if key == "query"
                            else f"{icon} {label}: {val}"
                        )
                        break
        payload["icon"] = icon
        payload["label"] = label
        payload["description"] = desc.strip()
        payload["step_number"] = step_counter

    # Format result summary (reuse SDK's static method)
    if is_completed and result is not None:
        try:
            from praisonaiagents.output.editor import EditorOutput

            formatted = EditorOutput._format_result(
                str(result)[:500] if result else None,
            )
            payload["formatted_result"] = formatted or "✓ Done"
        except (ImportError, AttributeError):
            payload["formatted_result"] = "✓ Done"

    return payload


# ── Data Model ───────────────────────────────────────────────────────


@dataclass
class ChatMessage:
    """A single chat message (user or assistant).

    Protocol-compatible data model — wire-safe via ``to_dict()``.
    """

    role: str  # "user" | "assistant" | "system" | "tool"
    content: str
    session_id: str
    message_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    agent_name: Optional[str] = None
    timestamp: float = field(default_factory=time.time)
    metadata: Optional[Dict[str, Any]] = None
    elements: Optional[List[Dict[str, Any]]] = None
    # Terminal state of an assistant turn when it did not complete normally.
    # ``"cancelled"`` marks a reply that was cut short by Stop/abort so a
    # history reload does not present a partial answer as complete.
    status: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "role": self.role,
            "content": self.content,
            "session_id": self.session_id,
            "message_id": self.message_id,
            "timestamp": self.timestamp,
        }
        if self.agent_name:
            d["agent_name"] = self.agent_name
        if self.metadata:
            d["metadata"] = self.metadata
        if self.elements:
            d["elements"] = self.elements
        if self.status:
            d["status"] = self.status
        return d


# ── Protocol ─────────────────────────────────────────────────────────


class ChatProtocol(ABC):
    """Protocol interface for chat backends.

    Any chat implementation (gateway, direct, custom) implements this.
    PraisonAIUI is agnostic to the backend.
    """

    @abstractmethod
    async def send_message(
        self,
        content: str,
        *,
        session_id: str,
        agent_name: Optional[str] = None,
        attachments: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Send a message and return result metadata (message_id, etc.)."""
        ...

    @abstractmethod
    async def get_history(
        self,
        session_id: str,
        *,
        limit: int = 50,
        before: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return message history for a session."""
        ...

    @abstractmethod
    async def abort_run(self, run_id: str) -> Dict[str, Any]:
        """Abort a running agent execution."""
        ...

    async def stream_response(
        self,
        content: str,
        *,
        session_id: str,
        agent_name: Optional[str] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """Stream response deltas. Default: call send_message."""
        result = await self.send_message(
            content,
            session_id=session_id,
            agent_name=agent_name,
        )
        yield {"type": "chat_complete", **result}


# ── Default Implementation ───────────────────────────────────────────


class ChatManager(ChatProtocol):
    """Default chat manager — bridges to the server's provider/SSE system.

    Config-driven: works out of the box with any registered provider.
    """

    def __init__(self) -> None:
        self._active_runs: Dict[str, asyncio.Task] = {}
        # run_id → session_id for every run started by ``_run_and_broadcast``.
        # Used to check that a WS ``chat_abort`` comes from a client that
        # owns the run's session.
        self._run_sessions: Dict[str, str] = {}
        self._history: Dict[str, List[ChatMessage]] = {}
        self._ws_clients: Dict[str, WebSocket] = {}
        # Per-client session scoping (see ``broadcast``).
        #   * ``_ws_subscriptions`` holds an entry only for clients that sent
        #     ``{type: "subscribe"}`` (or ``unsubscribe``). Those clients are
        #     "scoped": they receive only their own sessions' events.
        #   * Clients with no entry are legacy clients (dashboard chat.js,
        #     mini-chat, debug view…) and keep receiving every session's
        #     events, exactly as before.
        #   * ``_ws_sent_sessions`` records the sessions a client started a
        #     turn in over this connection. Scoped clients always receive
        #     those, and every client may abort runs in them.
        self._ws_subscriptions: Dict[str, Set[str]] = {}
        self._ws_sent_sessions: Dict[str, Set[str]] = {}

    async def send_message(
        self,
        content: str,
        *,
        session_id: str,
        agent_name: Optional[str] = None,
        attachments: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Send a message and run the agent. Returns message metadata."""
        msg = ChatMessage(
            role="user",
            content=content,
            session_id=session_id,
            agent_name=agent_name,
        )

        # Store in history
        if session_id not in self._history:
            self._history[session_id] = []
        self._history[session_id].append(msg)

        return {
            "message_id": msg.message_id,
            "session_id": session_id,
            "status": "sent",
        }

    async def get_history(
        self,
        session_id: str,
        *,
        limit: int = 50,
        before: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return message history for a session."""
        messages = list(self._history.get(session_id, []))  # snapshot
        return [m.to_dict() for m in messages[-limit:]]

    async def abort_run(self, run_id: str) -> Dict[str, Any]:
        """Abort a running agent execution."""
        task = self._active_runs.get(run_id)
        if task and not task.done():
            task.cancel()
            self._active_runs.pop(run_id, None)

            # Invoke registered @aiui.cancel callback
            try:
                from praisonaiui.server import _callbacks

                cancel_cb = _callbacks.get("cancel")
                if cancel_cb:
                    import asyncio

                    r = cancel_cb()
                    if asyncio.iscoroutine(r):
                        await r
            except Exception:
                pass

            return {"status": "aborted", "run_id": run_id}
        return {"status": "no_active_run", "run_id": run_id}

    def add_ws_client(self, client_id: str, ws: WebSocket) -> None:
        self._ws_clients[client_id] = ws

    def remove_ws_client(self, client_id: str) -> None:
        self._ws_clients.pop(client_id, None)
        self._ws_subscriptions.pop(client_id, None)
        self._ws_sent_sessions.pop(client_id, None)

    # ── Per-client session scoping ───────────────────────────────────

    def subscribe(self, client_id: str, session_ids: Iterable[Any]) -> List[str]:
        """Scope *client_id* to *session_ids* (added to any earlier set).

        The first ``subscribe`` (even with an empty list) turns the client
        into a scoped client: from then on ``broadcast`` only sends it events
        for sessions it subscribed to or started a turn in. Returns the
        client's current subscription list (sorted).
        """
        subs = self._ws_subscriptions.setdefault(client_id, set())
        for sid in _clean_session_ids(session_ids):
            if sid in subs:
                continue
            if len(subs) >= MAX_SUBSCRIPTIONS_PER_CLIENT:
                logger.warning(
                    "Chat WS client %s hit the subscription cap (%d); ignoring the rest",
                    client_id,
                    MAX_SUBSCRIPTIONS_PER_CLIENT,
                )
                break
            subs.add(sid)
        return sorted(subs)

    def unsubscribe(self, client_id: str, session_ids: Iterable[Any]) -> List[str]:
        """Stop delivering *session_ids* to *client_id*.

        Also makes the client scoped (a legacy client that unsubscribes from
        one session has asked not to receive everything). Removing a session
        the client started a turn in also drops its right to abort runs there.
        """
        subs = self._ws_subscriptions.setdefault(client_id, set())
        sent = self._ws_sent_sessions.get(client_id)
        for sid in _clean_session_ids(session_ids):
            subs.discard(sid)
            if sent is not None:
                sent.discard(sid)
        return sorted(subs)

    def note_client_session(self, client_id: str, session_id: str) -> None:
        """Record that *client_id* started a turn in *session_id*."""
        if not isinstance(session_id, str) or not session_id:
            return
        sent = self._ws_sent_sessions.setdefault(client_id, set())
        if session_id in sent or len(sent) < MAX_SUBSCRIPTIONS_PER_CLIENT:
            sent.add(session_id)

    def is_scoped(self, client_id: str) -> bool:
        """True once the client has sent ``subscribe``/``unsubscribe``."""
        return client_id in self._ws_subscriptions

    def client_owns_session(self, client_id: str, session_id: Optional[str]) -> bool:
        """True if *client_id* started a turn in or subscribed to *session_id*."""
        if not session_id:
            return False
        return session_id in self._ws_sent_sessions.get(
            client_id, ()
        ) or session_id in self._ws_subscriptions.get(client_id, ())

    def _delivers_to(self, client_id: str, session_id: str) -> bool:
        if not session_id:
            # Session-less events (e.g. a global a2ui surface) cannot be
            # scoped, so every client gets them, as before.
            return True
        if client_id not in self._ws_subscriptions:
            return True  # legacy client: unchanged fan-out of every session
        return self.client_owns_session(client_id, session_id)

    def session_for_run(self, run_id: str) -> Optional[str]:
        """Return the session a running ``run_id`` belongs to, if known."""
        if not isinstance(run_id, str):
            return None
        return self._run_sessions.get(run_id)

    async def broadcast(self, session_id: str, event: Dict[str, Any]) -> None:
        """Send an event to the WS clients watching *session_id*.

        Delivery is per client:

        * legacy clients (never sent ``subscribe``) receive every event, which
          keeps the dashboard's unread dots and channel messages working;
        * scoped clients receive only events for sessions they subscribed to
          or started a turn in;
        * an empty *session_id* goes to everyone.

        Uses ``list()`` snapshot of ``_ws_clients`` to prevent
        ``RuntimeError: dictionary changed size during iteration``
        when clients connect/disconnect during the async yield in
        ``ws.send_text()``.
        """
        data = json.dumps(event)
        dead = []
        for cid, ws in list(self._ws_clients.items()):  # snapshot — mutation-safe
            if not self._delivers_to(cid, session_id):
                continue
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(cid)
        for cid in dead:
            self.remove_ws_client(cid)


# ── Module-level singleton ───────────────────────────────────────────

_chat_manager: Optional[ChatManager] = None


def get_chat_manager() -> ChatManager:
    global _chat_manager
    if _chat_manager is None:
        _chat_manager = ChatManager()
    return _chat_manager


def set_chat_manager(manager: ChatManager) -> None:
    global _chat_manager
    _chat_manager = manager


# ── HTTP Handlers ────────────────────────────────────────────────────


async def _chat_send(request: Request) -> JSONResponse:
    """POST /api/chat/send — send a chat message."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    content = body.get("content") or body.get("message", "")
    session_id = body.get("session_id", str(uuid.uuid4()))
    agent_name = body.get("agent_name") or body.get("agent")
    attachment_ids = body.get("attachment_ids") or body.get("attachments") or []
    attachments = attachment_ids  # compat alias for send_message

    if not content:
        return JSONResponse({"error": "content required"}, status_code=400)

    # ── Guardrail pre-check (lazy import) ────────────────────────
    try:
        from .guardrails import check_guardrails

        violation = await check_guardrails(content, agent_name=agent_name or "", direction="input")
        if violation and violation.get("blocked"):
            return JSONResponse(
                {
                    "guardrail_blocked": True,
                    "reason": violation.get("reason", ""),
                    "guardrail_id": violation.get("guardrail_id", ""),
                    "description": violation.get("description", ""),
                },
                status_code=422,
            )
    except ImportError:
        pass
    except Exception:
        pass  # fail-open: don't block chat if guardrail system errors

    mgr = get_chat_manager()
    result = await mgr.send_message(
        content,
        session_id=session_id,
        agent_name=agent_name,
        attachments=attachments,
    )

    # Persist user message to datastore
    from praisonaiui.server import _datastore

    try:
        existing = await _datastore.get_session(session_id)
        if existing is None:
            await _datastore.create_session(session_id)
        await _datastore.add_message(
            session_id,
            {
                "role": "user",
                "content": content,
            },
        )
    except Exception:
        pass

    # Also run the provider and stream results to WS clients
    asyncio.create_task(_run_and_broadcast(content, session_id, agent_name, attachment_ids or None))

    return JSONResponse(result)


async def _resolve_agent_name(
    provider: Any,
    agent_name: Optional[str],
    session_id: str,
) -> Optional[str]:
    """Ask the provider which agent will answer, before the run starts.

    Providers may implement ``resolve_agent_name(agent_name=, session_id=)``
    (sync or async). Providers without it, or a resolver that fails, keep
    the requested *agent_name*.
    """
    resolver = getattr(provider, "resolve_agent_name", None)
    if not callable(resolver):
        return agent_name
    try:
        resolved = resolver(agent_name=agent_name, session_id=session_id)
        if asyncio.iscoroutine(resolved):
            resolved = await resolved
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # never block a turn on naming
        logger.debug("resolve_agent_name failed: %s", exc)
        return agent_name
    if isinstance(resolved, str) and resolved:
        return resolved
    return agent_name


async def _run_and_broadcast(
    content: str,
    session_id: str,
    agent_name: Optional[str],
    attachment_ids: Optional[List[str]] = None,
) -> None:
    """Run the provider and broadcast streaming events to WS clients."""
    from praisonaiui.provider import RunEventType
    from praisonaiui.server import _datastore, get_provider

    # Load attachment content and prepare for provider
    sdk_attachments = []  # Image file paths → passed to Agent.chat(attachments=[...])
    if attachment_ids:
        try:
            from praisonaiui.features.attachments import get_attachment_manager

            att_mgr = get_attachment_manager()
            pdf_context_parts = []
            for att_id in attachment_ids:
                meta = att_mgr.get(att_id)
                if not meta:
                    continue
                path = meta.get("path", "")
                ct = meta.get("content_type", "")
                fname = meta.get("filename", "file")

                if ct.startswith("image/"):
                    # Images → pass file path to SDK's native multimodal handling
                    sdk_attachments.append(path)
                elif ct == "application/pdf":
                    # PDFs → extract text and prepend to message
                    try:
                        try:
                            from pypdf import PdfReader
                        except ImportError:
                            from PyPDF2 import PdfReader
                        reader = PdfReader(path)
                        text = "\n".join(page.extract_text() or "" for page in reader.pages)
                        pdf_context_parts.append(
                            f"--- Attached PDF: {fname} ---\n{text}\n--- End of {fname} ---"
                        )
                    except ImportError:
                        import os

                        pdf_context_parts.append(
                            f"[PDF file: {fname}, {os.path.getsize(path)} bytes "
                            f"— install pypdf for text extraction]"
                        )
                    except Exception as e:
                        pdf_context_parts.append(f"[Error reading {fname}: {e}]")
                else:
                    # Other text-based files → read and prepend
                    try:
                        with open(path, "r", errors="replace") as f:
                            text = f.read()
                        pdf_context_parts.append(
                            f"--- Attached File: {fname} ---\n{text}\n--- End of {fname} ---"
                        )
                    except Exception as e:
                        pdf_context_parts.append(f"[Error reading {fname}: {e}]")

            if pdf_context_parts:
                content = "\n\n".join(pdf_context_parts) + "\n\nUser message: " + content
        except Exception as e:
            logger.warning(f"Failed to load attachments: {e}")

    mgr = get_chat_manager()
    provider = get_provider()
    full_response = ""
    run_id = str(uuid.uuid4())
    tool_step_counter = 0  # Step numbering (resets per user message)
    # Dedup: both stream deltas AND hook events fire for the same tool call.
    # Track which tool calls we've already broadcast to avoid duplicates.
    _seen_tool_started: set = set()  # tool_call_id or name we've sent STARTED for
    _seen_tool_completed: set = set()  # tool_call_id or name we've sent COMPLETED for
    collected_tool_calls: Dict[str, Dict] = {}  # Merge STARTED+COMPLETED per tool_call_id
    collected_elements: List[Dict[str, Any]] = []
    cancelled = False
    resolved_agent_name = agent_name

    # Register this run so ``abort_run(run_id)`` can cancel it, and announce the
    # run to WS clients up-front. Without this the ``_active_runs`` registry was
    # never populated, so the Stop button and ``POST /api/chat/abort`` were
    # silent no-ops that always returned ``no_active_run`` (issue #274). The
    # ``run_started`` event also lets the frontend capture ``run_id`` and enable
    # the Stop button immediately, before the first token arrives.
    self_task = asyncio.current_task()
    if self_task is not None:
        mgr._active_runs[run_id] = self_task
    mgr._run_sessions[run_id] = session_id

    try:
        # Resolve the agent that will actually answer, so the single
        # ``run_started`` below carries its name. The provider's own
        # ``run_started`` is suppressed in the loop (exactly one per run), so
        # without this a provider-chosen name (e.g. the default agent when the
        # client sent none) would never reach the client.
        resolved_agent_name = await _resolve_agent_name(provider, agent_name, session_id)
        started_event: Dict[str, Any] = {
            "type": "run_started",
            "session_id": session_id,
            "run_id": run_id,
        }
        if resolved_agent_name:
            started_event["agent_name"] = resolved_agent_name
        await mgr.broadcast(session_id, started_event)

        # Pass image attachments to provider for SDK native multimodal handling
        run_kwargs = {}
        if sdk_attachments:
            run_kwargs["attachments"] = sdk_attachments
        async for event in provider.run(
            content,
            session_id=session_id,
            agent_name=agent_name,
            **run_kwargs,
        ):
            # Build broadcast payload
            payload: Dict[str, Any] = {
                "type": event.type.value,
                "session_id": session_id,
                "run_id": run_id,
            }

            if event.type == RunEventType.RUN_STARTED:
                # Already announced above with this run_id (and the resolved
                # agent name). Forwarding the provider's copy made WS clients
                # see two run_started frames per turn.
                continue
            if event.type == RunEventType.RUN_CANCELLED:
                cancelled = True

            if event.type == RunEventType.RUN_CONTENT:
                token = event.token or ""
                if token and token != "None":
                    payload["token"] = token
                    full_response += token
            elif event.type == RunEventType.RUN_COMPLETED:
                content = event.content or full_response
                if content == "None":
                    content = ""
                payload["content"] = content
                if content:
                    full_response = content
            elif event.type == RunEventType.RUN_ERROR:
                payload["error"] = event.error or "Unknown error"
            elif event.type == RunEventType.TOOL_CALL_STARTED:
                # Skip events without a name
                if not event.name:
                    continue

                # Check if this is a rich event with complete parsed args
                # (from TOOL_CALL_START, not DELTA_TOOL_CALL)
                has_complete_args = (getattr(event, "extra_data", None) or {}).get(
                    "has_complete_args", False
                )

                # Dedup key: prefer tool_call_id (stream), fall back to name (hook)
                dedup_key = event.tool_call_id or event.name
                if dedup_key in _seen_tool_started:
                    if has_complete_args:
                        # This is a TOOL_CALL_START update with complete args —
                        # re-broadcast to update the step's description with
                        # keyword-rich text (e.g., "Searching for 'Django'")
                        payload["name"] = event.name
                        payload["args"] = event.args
                        payload["tool_call_id"] = event.tool_call_id or dedup_key
                        _enrich_tool_payload(payload, tool_step_counter, is_completed=False)
                        # Broadcast update but don't increment step counter
                    else:
                        continue  # True duplicate
                else:
                    _seen_tool_started.add(dedup_key)
                    # Also add name as secondary key so hook won't re-fire
                    if event.name:
                        _seen_tool_started.add(event.name)

                    tool_step_counter += 1
                    payload["name"] = event.name
                    payload["args"] = event.args
                    payload["tool_call_id"] = event.tool_call_id or str(uuid.uuid4())
                    _enrich_tool_payload(payload, tool_step_counter, is_completed=False)
                    tc_id = payload.get("tool_call_id", str(uuid.uuid4()))
                    collected_tool_calls[tc_id] = dict(payload)
            elif event.type == RunEventType.TOOL_CALL_COMPLETED:
                # Dedup completed events
                dedup_key = event.tool_call_id or event.name or ""
                if dedup_key and dedup_key in _seen_tool_completed:
                    # Allow TOOL_CALL_RESULT (has_complete_args) to update
                    has_complete_args = (getattr(event, "extra_data", None) or {}).get(
                        "has_complete_args", False
                    )
                    if not has_complete_args:
                        continue
                if dedup_key:
                    _seen_tool_completed.add(dedup_key)
                    if event.name:
                        _seen_tool_completed.add(event.name)
                payload["name"] = event.name
                payload["args"] = event.args
                payload["result"] = event.result
                payload["tool_call_id"] = event.tool_call_id
                _enrich_tool_payload(payload, tool_step_counter, is_completed=True)
                extra = getattr(event, "extra_data", None) or {}
                if extra.get("a2ui"):
                    payload["a2ui"] = extra["a2ui"]
                    payload["surface_id"] = extra.get("surface_id", "main")
                    try:
                        from praisonaiui.features.surfaces import ingest_a2ui_extra

                        await ingest_a2ui_extra(extra, session_id=session_id)
                    except ImportError:
                        pass
                if extra.get("elements"):
                    # Elements are deliberately sent twice: inline on this
                    # tool_call_completed frame (``elements``) and as one
                    # ``message_element`` frame each. Older clients read one
                    # or the other; current clients dedupe by ``url``. Do not
                    # drop either copy without a protocol version bump.
                    payload["elements"] = extra["elements"]
                    for el in extra["elements"]:
                        if isinstance(el, dict):
                            _collect_element(collected_elements, el)
                            await mgr.broadcast(
                                session_id,
                                {
                                    "type": "message_element",
                                    "session_id": session_id,
                                    "run_id": run_id,
                                    "element": el,
                                },
                            )
                # Merge COMPLETED into STARTED entry (richer args + result)
                tc_id = payload.get("tool_call_id", "")
                if tc_id in collected_tool_calls:
                    entry = collected_tool_calls[tc_id]
                    entry["args"] = payload.get("args", entry.get("args"))
                    entry["result"] = payload.get("result")
                    entry["formatted_result"] = payload.get("formatted_result", "✓ Done")
                    entry["status"] = "done"
                    if payload.get("elements"):
                        entry["elements"] = payload["elements"]
                    if payload.get("a2ui"):
                        entry["a2ui"] = payload["a2ui"]
                        entry["surface_id"] = payload.get("surface_id")
                    # Re-enrich description with full args (now has keywords)
                    _enrich_tool_payload(entry, entry.get("step_number", 0), is_completed=False)
                else:
                    collected_tool_calls[tc_id] = dict(payload)
            elif event.type in (
                RunEventType.REASONING_STARTED,
                RunEventType.REASONING_STEP,
                RunEventType.REASONING_COMPLETED,
            ):
                payload["step"] = event.step
            elif event.type == RunEventType.RUN_PAUSED:
                extra = getattr(event, "extra_data", None) or {}
                if not isinstance(extra, dict):
                    extra = {}
                payload.update(_paused_payload_fields(extra, collected_tool_calls))
            elif event.type == RunEventType.REFERENCES:
                extra = getattr(event, "extra_data", None) or {}
                if not isinstance(extra, dict):
                    extra = {}
                query = event.query if event.query is not None else extra.get("query")
                refs = event.references if event.references is not None else extra.get(
                    "references"
                )
                payload["query"] = query or ""
                payload["references"] = list(refs) if isinstance(refs, (list, tuple)) else []
                if event.time_ms is not None:
                    payload["time_ms"] = event.time_ms
            elif event.type in (
                RunEventType.MEMORY_UPDATE_STARTED,
                RunEventType.UPDATING_MEMORY,
                RunEventType.MEMORY_UPDATE_COMPLETED,
            ):
                if event.extra_data:
                    payload["memory_data"] = event.extra_data
            elif event.type == RunEventType.LLM_CONTENT:
                # Intermediate narrative text between tool calls
                payload["content"] = event.content or ""
            elif event.type == RunEventType.MESSAGE_ELEMENT:
                extra = getattr(event, "extra_data", None) or {}
                element = extra.get("element")
                if not element or not isinstance(element, dict):
                    continue
                payload["element"] = element
                _collect_element(collected_elements, element)

            if event.agent_name:
                payload["agent_name"] = event.agent_name

            await mgr.broadcast(session_id, payload)

    except asyncio.CancelledError:
        cancelled = True
        await mgr.broadcast(
            session_id,
            {
                "type": "run_cancelled",
                "session_id": session_id,
                "run_id": run_id,
            },
        )
    except Exception as e:
        logger.error(f"Chat run error: {e}")
        await mgr.broadcast(
            session_id,
            {
                "type": "run_error",
                "session_id": session_id,
                "run_id": run_id,
                "error": str(e),
            },
        )
    finally:
        # Always deregister the run, on normal completion, error, or abort.
        mgr._active_runs.pop(run_id, None)
        mgr._run_sessions.pop(run_id, None)

    # Save assistant response
    if full_response or collected_elements:
        assistant_msg = ChatMessage(
            role="assistant",
            content=full_response or "",
            session_id=session_id,
            agent_name=resolved_agent_name,
            elements=collected_elements or None,
            status="cancelled" if cancelled else None,
        )
        mgr._history.setdefault(session_id, []).append(assistant_msg)

        # Also persist in datastore (include tool calls for history)
        try:
            msg_data: dict = {
                "role": "assistant",
                "content": full_response or "",
            }
            if collected_tool_calls:
                msg_data["toolCalls"] = list(collected_tool_calls.values())
            if collected_elements:
                msg_data["elements"] = collected_elements
            if cancelled:
                # A reply cut short by Stop/abort. Without this flag a reload
                # shows the partial text as a complete answer.
                msg_data["status"] = "cancelled"
            await _datastore.add_message(session_id, msg_data)
        except Exception:
            pass


DEFAULT_CONTEXT_LIMIT = 128000
_TOKENS_PER_CHAR = 0.25
_SYSTEM_BASELINE_TOKENS = 800
_TOOLS_BASELINE_TOKENS = 400


def _estimate_context_stats(
    messages: List[Dict[str, Any]],
    *,
    session_id: str,
    limit: int = DEFAULT_CONTEXT_LIMIT,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute a char-based context usage estimate for a session.

    No tokenizer dependency: approximates tokens as ``chars * 0.25`` and
    adds fixed system/tools baselines. Returns a wire-safe dict with a
    deterministic, sorted breakdown. ``estimate`` is always ``True`` since
    this is a heuristic, not a provider-reported count.
    """
    message_chars = 0
    tool_chars = 0
    memory_chars = 0
    for m in messages:
        content = m.get("content") or ""
        message_chars += len(str(content))
        tool_calls = m.get("toolCalls") or m.get("tool_calls") or []
        for tc in tool_calls:
            tool_chars += len(str(tc.get("args", "")))
            tool_chars += len(str(tc.get("result", "")))
        for el in m.get("elements") or []:
            memory_chars += len(str(el.get("url", "")))

    system_tokens = _SYSTEM_BASELINE_TOKENS
    tools_tokens = _TOOLS_BASELINE_TOKENS + int(tool_chars * _TOKENS_PER_CHAR)
    messages_tokens = int(message_chars * _TOKENS_PER_CHAR)
    memory_tokens = int(memory_chars * _TOKENS_PER_CHAR)

    breakdown = {
        "memory": memory_tokens,
        "messages": messages_tokens,
        "system": system_tokens,
        "tools": tools_tokens,
    }
    used = system_tokens + tools_tokens + messages_tokens + memory_tokens
    safe_limit = limit if limit and limit > 0 else DEFAULT_CONTEXT_LIMIT
    usage_pct = round((used / safe_limit) * 100, 1) if safe_limit else 0.0

    result: Dict[str, Any] = {
        "breakdown": breakdown,
        "estimate": True,
        "limit": limit,
        "session_id": session_id,
        "usage_pct": usage_pct,
        "used": used,
    }
    if model:
        result["model"] = model
    return result


async def _chat_context_stats(request: Request) -> JSONResponse:
    """GET /api/chat/context-stats?session_id= — context budget estimate.

    Config-driven fallback for the composer token ring. Computes a
    char-based estimate from persisted messages; unknown sessions return
    a zero-usage estimate rather than 404 so the UI can always render.
    """
    session_id = request.query_params.get("session_id", "")
    try:
        limit = int(request.query_params.get("limit", str(DEFAULT_CONTEXT_LIMIT)))
    except (TypeError, ValueError):
        limit = DEFAULT_CONTEXT_LIMIT

    messages: List[Dict[str, Any]] = []
    if session_id:
        try:
            from praisonaiui.server import _datastore

            messages = await _datastore.get_messages(session_id) or []
        except Exception:
            messages = []

    stats = _estimate_context_stats(messages, session_id=session_id, limit=limit)
    return JSONResponse(stats)


async def _chat_history(request: Request) -> JSONResponse:
    """GET /api/chat/history/{session_id} — get message history."""
    session_id = request.path_params["session_id"]
    limit = int(request.query_params.get("limit", "50"))

    # Read from persistent datastore first
    from praisonaiui.server import _datastore

    messages = await _datastore.get_messages(session_id)

    if not messages:
        # Fall back to in-memory ChatManager for backward compat
        mgr = get_chat_manager()
        messages = await mgr.get_history(session_id, limit=limit)
    else:
        messages = messages[-limit:]

    # Include session-level metadata (platform, icon) for channel sessions
    result: dict = {"messages": messages, "session_id": session_id}
    session = await _datastore.get_session(session_id)
    if session:
        if session.get("platform"):
            result["platform"] = session["platform"]
        if session.get("icon"):
            result["icon"] = session["icon"]

    return JSONResponse(result)


async def _chat_abort(request: Request) -> JSONResponse:
    """POST /api/chat/abort — abort a running agent."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    run_id = body.get("run_id", "")
    mgr = get_chat_manager()
    result = await mgr.abort_run(run_id)
    return JSONResponse(result)


async def _ws_abort(mgr: ChatManager, client_id: str, run_id: Any) -> Dict[str, Any]:
    """Handle a WS ``chat_abort``: only the session's owner may stop a run.

    The owner is a client that started a turn in the run's session over this
    connection or subscribed to it. Unknown or finished runs answer
    ``no_active_run`` as before; a live run owned by someone else answers
    ``forbidden`` and keeps running.
    """
    reply: Dict[str, Any] = {"type": "chat_abort_result"}
    if not isinstance(run_id, str) or not run_id:
        reply.update({"status": "no_active_run", "run_id": run_id if run_id else ""})
        return reply
    task = mgr._active_runs.get(run_id)
    if task is None or task.done():
        reply.update(await mgr.abort_run(run_id))
        return reply
    owner_session = mgr.session_for_run(run_id)
    if owner_session is None or not mgr.client_owns_session(client_id, owner_session):
        logger.warning("Chat WS client %s may not abort run %s", client_id, run_id)
        reply.update(
            {
                "status": "forbidden",
                "run_id": run_id,
                "error": "run belongs to a session this connection did not start or subscribe to",
            }
        )
        return reply
    reply.update(await mgr.abort_run(run_id))
    return reply


async def _chat_ws(websocket: WebSocket) -> None:
    """WebSocket /api/chat/ws — real-time chat with streaming.

    Client → server messages:

    * ``{type: "chat", content, session_id?, agent_name?, attachment_ids?}``
    * ``{type: "chat_abort", run_id}`` — allowed only for runs in a session
      this connection started a turn in or subscribed to; answered with
      ``{type: "chat_abort_result", status, run_id}``.
    * ``{type: "ask_response", session_id, run_id, response}``
    * ``{type: "subscribe", session_ids: [...]}`` / ``{type: "unsubscribe",
      session_ids: [...]}`` — opt into per-session delivery; answered with
      ``{type: "subscribed", session_ids}``. Clients that never subscribe
      keep receiving every session's events (legacy behaviour).
    * ``{type: "ping"}`` → ``{type: "pong"}``
    """
    await websocket.accept()
    client_id = str(uuid.uuid4())
    mgr = get_chat_manager()
    mgr.add_ws_client(client_id, websocket)

    logger.info(f"Chat WS client connected: {client_id}")

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "chat")

            if msg_type == "chat":
                content = data.get("content", "")
                session_id = data.get("session_id", str(uuid.uuid4()))
                agent_name = data.get("agent_name") or data.get("agent")

                if content:
                    # ── Guardrail pre-check ──────────────────────
                    guardrail_blocked = False
                    try:
                        from .guardrails import check_guardrails

                        violation = await check_guardrails(
                            content,
                            agent_name=agent_name or "",
                            direction="input",
                        )
                        if violation and violation.get("blocked"):
                            guardrail_blocked = True
                            await websocket.send_json(
                                {
                                    "type": "run_error",
                                    "session_id": session_id,
                                    "guardrail_blocked": True,
                                    "error": f"🛡️ Guardrail violation: {violation.get('reason', violation.get('description', 'Blocked by guardrail'))}",
                                    "guardrail_id": violation.get("guardrail_id", ""),
                                }
                            )
                    except ImportError:
                        pass
                    except Exception:
                        pass  # fail-open

                    if guardrail_blocked:
                        continue  # skip agent run, wait for next message

                    # This client now owns the session: it may abort runs
                    # in it, and (if scoped) receives its events.
                    mgr.note_client_session(client_id, session_id)
                    # Store user message in ChatManager
                    await mgr.send_message(
                        content,
                        session_id=session_id,
                        agent_name=agent_name,
                    )
                    # Also persist user message to datastore
                    from praisonaiui.server import _datastore

                    try:
                        existing = await _datastore.get_session(session_id)
                        if existing is None:
                            await _datastore.create_session(session_id)
                        await _datastore.add_message(
                            session_id,
                            {
                                "role": "user",
                                "content": content,
                            },
                        )
                    except Exception:
                        pass
                    # Extract attachment_ids
                    att_ids = data.get("attachment_ids") or []
                    # Run agent and broadcast
                    asyncio.create_task(
                        _run_and_broadcast(content, session_id, agent_name, att_ids)
                    )

            elif msg_type == "chat_abort":
                run_id = data.get("run_id", "")
                result = await _ws_abort(mgr, client_id, run_id)
                await websocket.send_json(result)

            elif msg_type in ("subscribe", "unsubscribe"):
                ids = data.get("session_ids")
                if ids is None:
                    ids = data.get("session_id")
                if msg_type == "subscribe":
                    current = mgr.subscribe(client_id, ids or [])
                else:
                    current = mgr.unsubscribe(client_id, ids or [])
                await websocket.send_json({"type": "subscribed", "session_ids": current})

            elif msg_type == "ask_response":
                response = data.get("response", "")
                session_id = data.get("session_id", "")
                run_id = data.get("run_id", "")
                logger.info(f"Ask response received: {response[:100]} (session={session_id})")
                # Forward to provider's ask response queue if available
                from praisonaiui.server import get_provider

                provider = get_provider()
                if hasattr(provider, "submit_ask_response"):
                    await provider.submit_ask_response(session_id, run_id, response)
                # Acknowledge
                await websocket.send_json(
                    {
                        "type": "ask_response_ack",
                        "session_id": session_id,
                        "status": "received",
                    }
                )

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info(f"Chat WS client disconnected: {client_id}")
    except Exception as e:
        logger.error(f"Chat WS error: {e}")
    finally:
        mgr.remove_ws_client(client_id)


# ── Feature Protocol Implementation ─────────────────────────────────


class ChatFeature(BaseFeatureProtocol):
    """Chat feature — protocol-driven, config-driven.

    Provides:
      * WebSocket real-time chat (/api/chat/ws)
      * REST send (/api/chat/send)
      * REST history (/api/chat/history/{session_id})
      * REST abort (/api/chat/abort)
    """

    feature_name = "chat"
    feature_description = "Real-time agent chat with streaming"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/chat/send", _chat_send, methods=["POST"]),
            Route("/api/chat/context-stats", _chat_context_stats, methods=["GET"]),
            Route("/api/chat/history/{session_id}", _chat_history, methods=["GET"]),
            Route("/api/chat/abort", _chat_abort, methods=["POST"]),
            WebSocketRoute("/api/chat/ws", _chat_ws),
        ]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        mgr = get_chat_manager()
        return {
            "status": "ok",
            "feature": self.name,
            "active_clients": len(mgr._ws_clients),
            "sessions_cached": len(mgr._history),
            **gateway_health(),
        }


# Backward-compat alias
PraisonAIChat = ChatFeature
