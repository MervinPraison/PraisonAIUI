"""Handler context: who is calling, from where, and this chat's own state.

Inside ``@aiui.reply`` (and tasks or ``aiui.make_async`` threads it starts):
``aiui.context.session`` is the calling :class:`ChatSession`,
``aiui.user_session`` a key/value store private to the chat and
``aiui.chat_context`` the chat's history. All resolve through one ContextVar,
so concurrent chats never see each other's data. Per-chat state is kept in
memory for the last ``MAX_SESSIONS`` chats; history is reloaded from the
datastore the first time a chat runs in this process.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import re
import threading
import uuid
from collections import OrderedDict, deque
from collections.abc import MutableMapping
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Union

logger = logging.getLogger(__name__)

MAX_SESSIONS = 5000  # chats whose state is kept (least recent dropped first)
MAX_HISTORY = 200  # messages kept per chat (oldest dropped first)

_SECRET_HEADERS = {"authorization", "proxy-authorization", "cookie", "set-cookie"}
_SECRET_WORDS = ("token", "secret", "passw", "key", "auth", "session", "cookie", "signature")
_CLIENT_RE = re.compile(r"^[a-z0-9_-]{1,32}$")
_ROLES = ("system", "user", "assistant", "tool")


@dataclass
class ChatSession:
    """The chat a handler is answering, and who is on the other end."""

    id: str
    user: Optional[Dict[str, Any]] = None
    client_type: str = "api"  # "webapp", "api", "copilot" or a bot platform ("slack", ...)
    chat_profile: Optional[str] = None
    chat_settings: Dict[str, Any] = field(default_factory=dict)
    env: Dict[str, str] = field(default_factory=dict)
    language: Optional[str] = None  # best Accept-Language tag ("fr-CA")
    headers: Dict[str, str] = field(default_factory=dict)  # lower-cased, no credentials
    loop: Optional[asyncio.AbstractEventLoop] = field(default=None, repr=False, compare=False)


_session_var: contextvars.ContextVar[Optional[ChatSession]] = contextvars.ContextVar(
    "aiui_chat_session", default=None
)


class _ChatState:
    def __init__(self) -> None:
        self.values: Dict[str, Any] = {}
        self.history: deque = deque(maxlen=MAX_HISTORY)
        self.seeded = False


_states: "OrderedDict[str, _ChatState]" = OrderedDict()
_states_lock = threading.Lock()


def _state(session_id: str) -> _ChatState:
    with _states_lock:
        st = _states.get(session_id)
        if st is None:
            st = _states[session_id] = _ChatState()
            while len(_states) > MAX_SESSIONS:
                _states.popitem(last=False)
        _states.move_to_end(session_id)
        return st


def current_session() -> Optional[ChatSession]:
    """The chat being answered in this task or thread, or None outside a handler."""
    return _session_var.get()


def __getattr__(name: str) -> Any:
    if name == "session":  # aiui.context.session, read per call
        return _session_var.get()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def _require_state(what: str) -> _ChatState:
    sess = _session_var.get()
    if sess is None:
        raise RuntimeError(f"aiui.{what} is only available inside a chat handler")
    return _state(sess.id)



def language_from(accept_language: str) -> Optional[str]:
    """The highest-weighted tag of an Accept-Language header ("fr-CA,fr;q=0.8" -> "fr-CA")."""
    best, best_q = None, 0.0
    for part in (accept_language or "").split(","):
        tag, _, params = part.strip().partition(";")
        tag, params = tag.strip(), params.strip()
        try:
            q = float(params[2:]) if params.startswith("q=") else 1.0
        except ValueError:
            continue
        if tag and tag != "*" and len(tag) <= 35 and q > best_q:
            best, best_q = tag, q
    return best


def _scope_user(scope: dict) -> Optional[Dict[str, Any]]:
    state = scope.get("state") or {}
    if isinstance(state.get("user"), dict):
        return dict(state["user"])
    user_id = state.get("user_id")
    try:
        from praisonaiui import auth
        from praisonaiui.http_guard import websocket_token

        if not user_id and scope.get("type") == "websocket":
            user_id = auth.validate_token(websocket_token(scope))
        record = auth._users.get(user_id) if user_id else None
    except Exception:  # identity is best effort, never block a turn
        record = None
    if not user_id:
        return None
    return {k: v for k, v in (record or {"id": user_id}).items() if k != "password_hash"}


def session_from_scope(scope: dict, session_id: str, turn: Optional[dict] = None) -> ChatSession:
    """The :class:`ChatSession` for a turn that arrived on the ASGI *scope*.

    The turn (a chat frame or request body) may carry ``chat_profile``,
    ``chat_settings`` and ``env``; they stay with the chat for later turns.
    """
    from praisonaiui.http_guard import query_param

    headers: Dict[str, str] = {}
    for raw_key, raw_value in scope.get("headers") or ():
        key = raw_key.decode("latin-1").lower()
        if key not in _SECRET_HEADERS and not any(w in key for w in _SECRET_WORDS):
            headers[key] = raw_value.decode("latin-1")
    client = (query_param(scope, "client") or headers.get("x-aiui-client", "")).strip().lower()
    if not _CLIENT_RE.match(client):
        # A browser sends Origin on a WebSocket and Sec-Fetch-* on fetch().
        client = "webapp" if "origin" in headers or "sec-fetch-mode" in headers else "api"
    turn = turn if isinstance(turn, dict) else {}
    profile, settings, env = turn.get("chat_profile"), turn.get("chat_settings"), turn.get("env")
    return ChatSession(
        id=session_id,
        user=_scope_user(scope),
        client_type=client,
        chat_profile=profile if isinstance(profile, str) and profile else None,
        chat_settings=dict(settings) if isinstance(settings, dict) else {},
        env={str(k): str(v) for k, v in env.items()} if isinstance(env, dict) else {},
        language=language_from(headers.get("accept-language", "")),
        headers=headers,
    )



async def prepare_run(session_id: Optional[str], text: str) -> ChatSession:
    """Fill the chat's state for one turn and return the session to run it under."""
    sid = session_id or f"run-{uuid.uuid4().hex}"  # no chat id: share no state
    sess = _session_var.get()
    if sess is None or sess.id != sid:
        # Not from the chat routes: a bot adapter (channel context) or a script.
        from praisonaiui.features.platform_adapters import current_channel, current_user

        channel, user = current_channel() or {}, current_user()
        platform = channel.get("platform") or channel.get("kind")
        sess = ChatSession(
            id=sid,
            user=dict(user) if isinstance(user, dict) else None,
            client_type=str(platform) if platform else "api",
        )
    sess.loop = asyncio.get_running_loop()
    st = _state(sid)
    values = st.values
    values.update(id=sid, user=sess.user)
    # Profile, settings and env sent with a turn stick to the chat for later turns.
    if sess.chat_profile is None:
        from praisonaiui.server import get_selected_profile

        sess.chat_profile = values.get("chat_profile") or get_selected_profile()
    values["chat_profile"] = sess.chat_profile
    for key in ("chat_settings", "env"):
        if getattr(sess, key):
            values[key] = getattr(sess, key)
        else:
            setattr(sess, key, values.setdefault(key, {}))
    if not st.seeded:
        st.seeded = True
        if session_id:
            st.history.extend(await _saved_messages(session_id))
    last = st.history[-1] if st.history else {}
    if text and (last.get("role"), last.get("content")) != ("user", text):
        st.history.append({"role": "user", "content": text})
    return sess


def enter(session: ChatSession) -> None:
    """Make *session* current in the reply task, its user visible to aiui.current_user()."""
    _session_var.set(session)
    from praisonaiui.features.platform_adapters import _base

    if session.user and _base._current_user.get() is None:
        _base._current_user.set(session.user)


def record_reply(session: ChatSession, text: str) -> None:
    """Add the assistant's finished reply to the chat's history."""
    if text:
        _state(session.id).history.append({"role": "assistant", "content": text})


async def _saved_messages(session_id: str) -> List[Dict[str, Any]]:
    from praisonaiui.server import _datastore

    try:
        saved = await _datastore.get_messages(session_id)
    except Exception:
        logger.debug("chat_context: no saved history for %s", session_id, exc_info=True)
        return []
    return [
        {"role": m["role"], "content": m["content"]}
        for m in (saved or [])[-MAX_HISTORY:]
        if isinstance(m, dict) and m.get("role") in _ROLES and isinstance(m.get("content"), str)
    ]


class UserSession(MutableMapping):
    """Key/value state private to the current chat (``aiui.user_session``).

    Preset keys: ``id``, ``user``, ``chat_profile``, ``chat_settings``, ``env``.
    Reads outside a handler see an empty store; writes raise ``RuntimeError``.
    """

    def _values(self) -> Dict[str, Any]:
        sess = _session_var.get()
        return _state(sess.id).values if sess is not None else {}

    def set(self, key: str, value: Any) -> None:
        _require_state("user_session").values[key] = value

    def __getitem__(self, key: str) -> Any:
        return self._values()[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.set(key, value)

    def __delitem__(self, key: str) -> None:
        del _require_state("user_session").values[key]

    def __iter__(self) -> Iterator[str]:
        return iter(list(self._values()))

    def __len__(self) -> int:
        return len(self._values())


class ChatContext:
    """The current chat's messages, oldest first (``aiui.chat_context``)."""

    def get(self) -> List[Dict[str, Any]]:
        sess = _session_var.get()
        return [dict(m) for m in _state(sess.id).history] if sess is not None else []

    def add(self, content: Union[str, Dict[str, Any]], role: str = "assistant") -> Dict[str, Any]:
        """Append a message: a string with *role*, or a ``{"role", "content"}`` dict."""
        msg = dict(content) if isinstance(content, dict) else {"role": role, "content": str(content)}
        if msg.get("role") not in _ROLES:
            raise ValueError(f"role must be one of {', '.join(_ROLES)}")
        _require_state("chat_context").history.append(msg)
        return msg

    def remove(self, message: Dict[str, Any]) -> bool:
        """Remove the latest message equal to *message*; True if one was removed."""
        history = _require_state("chat_context").history
        for i in range(len(history) - 1, -1, -1):
            if history[i] == message:
                del history[i]
                return True
        return False

    def clear(self) -> None:
        _require_state("chat_context").history.clear()

    def to_openai(
        self, *, system: Optional[str] = None, max_messages: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """The history as OpenAI chat messages, with an optional system prompt first."""
        msgs = self.get()
        if max_messages is not None:
            msgs = msgs[-max_messages:] if max_messages > 0 else []
        out = [{"role": "system", "content": system}] if system else []
        for m in msgs:
            keep = ("role", "content", "name", "tool_call_id", "tool_calls")
            out.append({k: m[k] for k in keep if m.get(k) is not None} | {"content": m.get("content") or ""})
        return out


user_session = UserSession()
chat_context = ChatContext()
