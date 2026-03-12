"""Chat feature — protocol-driven real-time agent chat.

Gap 1–7 implementation:
  * ChatProtocol (interface any chat backend can implement)
  * ChatMessage (data model)
  * ChatManager (default implementation)
  * HTTP + WebSocket routes

Config-driven (Chainlit-like):
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
from typing import Any, AsyncIterator, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


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
        return d


# ── Protocol ─────────────────────────────────────────────────────────

class ChatProtocol(ABC):
    """Protocol interface for chat backends.

    Any chat implementation (gateway, direct, custom) implements this.
    PraisonAIUI is agnostic to the backend — just like Chainlit.
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
            content, session_id=session_id, agent_name=agent_name,
        )
        yield {"type": "chat_complete", **result}


# ── Default Implementation ───────────────────────────────────────────

class ChatManager(ChatProtocol):
    """Default chat manager — bridges to the server's provider/SSE system.

    Config-driven: works out of the box with any registered provider.
    """

    def __init__(self) -> None:
        self._active_runs: Dict[str, asyncio.Task] = {}
        self._history: Dict[str, List[ChatMessage]] = {}
        self._ws_clients: Dict[str, WebSocket] = {}

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

    async def broadcast(self, session_id: str, event: Dict[str, Any]) -> None:
        """Broadcast an event to all WS clients watching a session.

        Uses ``list()`` snapshot of ``_ws_clients`` to prevent
        ``RuntimeError: dictionary changed size during iteration``
        when clients connect/disconnect during the async yield in
        ``ws.send_text()``.
        """
        data = json.dumps(event)
        dead = []
        for cid, ws in list(self._ws_clients.items()):  # snapshot — mutation-safe
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(cid)
        for cid in dead:
            self._ws_clients.pop(cid, None)


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
            return JSONResponse({
                "guardrail_blocked": True,
                "reason": violation.get("reason", ""),
                "guardrail_id": violation.get("guardrail_id", ""),
                "description": violation.get("description", ""),
            }, status_code=422)
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
        await _datastore.add_message(session_id, {
            "role": "user",
            "content": content,
        })
    except Exception:
        pass

    # Also run the provider and stream results to WS clients
    asyncio.create_task(_run_and_broadcast(content, session_id, agent_name, attachment_ids or None))

    return JSONResponse(result)


async def _run_and_broadcast(
    content: str,
    session_id: str,
    agent_name: Optional[str],
    attachment_ids: Optional[List[str]] = None,
) -> None:
    """Run the provider and broadcast streaming events to WS clients."""
    from praisonaiui.server import get_provider, _datastore
    from praisonaiui.provider import RunEventType

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

    try:
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

            if event.type == RunEventType.RUN_CONTENT:
                payload["token"] = event.token or ""
                if event.token:
                    full_response += event.token
            elif event.type == RunEventType.RUN_COMPLETED:
                payload["content"] = event.content or full_response
                if event.content and not full_response:
                    full_response = event.content
            elif event.type == RunEventType.RUN_ERROR:
                payload["error"] = event.error or "Unknown error"
            elif event.type in (RunEventType.TOOL_CALL_STARTED, RunEventType.TOOL_CALL_COMPLETED):
                payload["name"] = event.name
                payload["args"] = event.args
                payload["result"] = event.result
            elif event.type in (RunEventType.REASONING_STARTED, RunEventType.REASONING_STEP, RunEventType.REASONING_COMPLETED):
                payload["step"] = event.step
            elif event.type == RunEventType.RUN_PAUSED:
                extra = getattr(event, "extra_data", {}) or {}
                payload["question"] = extra.get("question", "The agent needs your input")
                payload["options"] = extra.get("options", [])
            elif event.type in (RunEventType.MEMORY_UPDATE_STARTED, RunEventType.UPDATING_MEMORY, RunEventType.MEMORY_UPDATE_COMPLETED):
                if event.extra_data:
                    payload["memory_data"] = event.extra_data

            if event.agent_name:
                payload["agent_name"] = event.agent_name

            await mgr.broadcast(session_id, payload)

    except asyncio.CancelledError:
        await mgr.broadcast(session_id, {
            "type": "run_cancelled",
            "session_id": session_id,
            "run_id": run_id,
        })
    except Exception as e:
        logger.error(f"Chat run error: {e}")
        await mgr.broadcast(session_id, {
            "type": "run_error",
            "session_id": session_id,
            "error": str(e),
        })

    # Save assistant response
    if full_response:
        assistant_msg = ChatMessage(
            role="assistant",
            content=full_response,
            session_id=session_id,
            agent_name=agent_name,
        )
        mgr._history.setdefault(session_id, []).append(assistant_msg)

        # Also persist in datastore
        try:
            await _datastore.add_message(session_id, {
                "role": "assistant",
                "content": full_response,
            })
        except Exception:
            pass


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

    return JSONResponse({"messages": messages, "session_id": session_id})


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


async def _chat_ws(websocket: WebSocket) -> None:
    """WebSocket /api/chat/ws — real-time chat with streaming."""
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
                            content, agent_name=agent_name or "", direction="input",
                        )
                        if violation and violation.get("blocked"):
                            guardrail_blocked = True
                            await websocket.send_json({
                                "type": "run_error",
                                "session_id": session_id,
                                "guardrail_blocked": True,
                                "error": f"🛡️ Guardrail violation: {violation.get('reason', violation.get('description', 'Blocked by guardrail'))}",
                                "guardrail_id": violation.get("guardrail_id", ""),
                            })
                    except ImportError:
                        pass
                    except Exception:
                        pass  # fail-open

                    if guardrail_blocked:
                        continue  # skip agent run, wait for next message

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
                        await _datastore.add_message(session_id, {
                            "role": "user",
                            "content": content,
                        })
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
                result = await mgr.abort_run(run_id)
                await websocket.send_json(result)

            elif msg_type == "ask_response":
                response = data.get("response", "")
                session_id = data.get("session_id", "")
                run_id = data.get("run_id", "")
                logger.info(f"Ask response received: {response[:100]} (session={session_id})")
                # Forward to provider's ask response queue if available
                from praisonaiui.server import get_provider
                provider = get_provider()
                if hasattr(provider, 'submit_ask_response'):
                    await provider.submit_ask_response(session_id, run_id, response)
                # Acknowledge
                await websocket.send_json({
                    "type": "ask_response_ack",
                    "session_id": session_id,
                    "status": "received",
                })

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
    """Chat feature — protocol-driven, config-driven (like Chainlit).

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
