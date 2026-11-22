"""Page parameters and auto refresh for ``@aiui.page`` handlers.

``GET /api/pages/{id}/data`` passes the query string to a handler that takes
``params``, so a filtered view lives in the URL. ``refresh_every`` at
registration reaches the browser as ``_refresh_every`` in the data reply.
See ``docs/guides/server-pages.md``.
"""

from __future__ import annotations

import inspect
from typing import Any, Callable, Optional, Union

Params = dict[str, Union[str, list[str]]]

#: Page id -> auto refresh period in seconds (``refresh_every`` at registration).
_refresh_every: dict[str, float] = {}


def query_params(request: Any) -> Params:
    """The request's query string; a key given more than once is a list."""
    q = request.query_params
    return {k: (v[0] if len(v) == 1 else v) for k in q.keys() for v in [q.getlist(k)]}


def _params_mode(handler: Callable) -> str:
    """'kw', 'pos' or 'none': how ``handler`` takes the page params."""
    try:
        params = list(inspect.signature(handler).parameters.values())
    except (TypeError, ValueError):
        return "none"
    if any(p.name == "params" or p.kind is p.VAR_KEYWORD for p in params):
        return "kw"
    positional = (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    required = [p for p in params if p.kind in positional and p.default is p.empty]
    if len(required) == 1 or any(p.kind is p.VAR_POSITIONAL for p in params):
        return "pos"
    return "none"


async def call_page_handler(handler: Callable, params: Params) -> Any:
    """Call a page handler with ``params`` if it accepts them; await coroutines."""
    mode = _params_mode(handler)
    if mode == "kw":
        result = handler(params=params)
    else:
        result = handler(params) if mode == "pos" else handler()
    return await result if inspect.isawaitable(result) else result


def set_refresh_every(page_id: str, seconds: Optional[float]) -> None:
    """Re-fetch ``page_id`` every ``seconds`` while visible (None or 0 turns it off)."""
    if seconds:
        if seconds < 1:
            raise ValueError("refresh_every must be at least 1 second")
        _refresh_every[page_id] = float(seconds)
    else:
        _refresh_every.pop(page_id, None)


def with_refresh(page_id: str, result: dict) -> dict:
    """Add the page's registered ``_refresh_every`` to a data reply that lacks one."""
    seconds = _refresh_every.get(page_id)
    if seconds and "_refresh_every" not in result:
        result = {**result, "_refresh_every": seconds}
    return result


def reset() -> None:
    """Forget registered refresh periods (``server.reset_state``)."""
    _refresh_every.clear()
