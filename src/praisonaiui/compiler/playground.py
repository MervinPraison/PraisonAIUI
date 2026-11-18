"""Try-it data for endpoint pages (docs/features/openapi.md#try-it).

:func:`playground_data` is what the browser's request form (``src/frontend/src/docs/ApiPlayground.tsx``)
reads from ``openapi/try/<page>.json``: method, path, servers with their variables, each parameter
with its example and the body's example. Made at build time, so the browser never resolves a
``$ref`` or builds a sample itself.
"""

from __future__ import annotations

import json
import re
from typing import Any

from praisonaiui.compiler.code_samples import _IGNORED, _explicit, _text, build_request
from praisonaiui.compiler.openapi import ApiSpec, Operation
from praisonaiui.compiler.openapi_pages import _CYCLE, _media, merged, type_label

MODES = ("interactive", "simple", "none")
TRY_DIR = "openapi/try"  # openapi/try/<page slug>.json


def playground_mode(api: Any = None, frontmatter: dict | None = None) -> str:
    """A page's display mode: its front matter ``playground:``, else ``api.playground.display``."""
    own = (frontmatter or {}).get("playground")
    if own in MODES:
        return own
    return api.playground.display if api is not None and api.playground else "interactive"


def _param(spec: ApiSpec, param: dict) -> dict:
    """One input: ``x-default`` (on the parameter or its schema), else its written example."""
    s = merged(spec, param.get("schema") or {})
    items = merged(spec, s["items"]) if isinstance(s.get("items"), dict) else {}
    value = next((h["x-default"] for h in (param, s) if "x-default" in h), None)
    value = _explicit(spec, param) if value is None else value
    out: dict[str, Any] = {"name": str(param.get("name")), "in": param.get("in"),
                           "type": type_label(spec, param.get("schema") or {}),
                           **({"required": True} if param.get("required") else {})}
    if value is not _CYCLE and value is not None:
        out["example"] = ",".join(map(_text, value)) if isinstance(value, list) else _text(value)
    enum = next((x["enum"] for x in (s, items) if isinstance(x.get("enum"), list) and x["enum"]), None)
    if enum or s.get("type") == "boolean":
        out["enum"] = [_text(v) for v in enum or (True, False)]
    if s.get("type") == "array":
        out["array"] = True  # comma-separated in the input, one `name=` per value in the query
    return out


def _server(server: dict) -> dict:
    variables = server.get("variables") if isinstance(server.get("variables"), dict) else {}
    out: dict[str, Any] = {"url": str(server["url"])}
    if server.get("description"):
        out["description"] = str(server["description"])
    if variables:
        out["variables"] = {str(k): {"default": _text(v.get("default", "")), **(
            {"enum": [_text(x) for x in v["enum"]]} if isinstance(v.get("enum"), list) else {})}
            for k, v in variables.items() if isinstance(v, dict)}
    return out


def playground_data(spec: ApiSpec, op: Operation, prefill: bool = True) -> dict:
    """What Try it needs for ``op`` (``prefill``: inputs start with the examples, else empty)."""
    out: dict[str, Any] = {
        "method": op.method, "path": op.path, "prefill": prefill,
        "servers": [_server(s) for s in op.servers if isinstance(s, dict) and s.get("url")],
        "params": [_param(spec, p) for p in op.parameters if p.get("in") in ("path", "query", "header", "cookie")
                   and not (p.get("in") == "header" and str(p.get("name")).lower() in _IGNORED)],
    }
    request = build_request(spec, op)  # the body as the request examples send it
    if request.kind:
        body = request.body
        out["body"] = {"type": _media((op.request_body or {}).get("content"))[0],
                       "example": json.dumps(body, indent=2, ensure_ascii=False)
                       if request.kind in ("json", "multipart") else str(body),
                       **({"required": True} if (op.request_body or {}).get("required") else {})}
    return out


_AUTH = {"bearer": ("Authorization", "Bearer <token>"), "basic": ("Authorization", "Basic <encoded-value>"),
         "key": ("X-API-Key", "<api-key>")}


def _typed(kind: str, value: str) -> Any:
    """A ``<ParamField body>`` example in the JSON body: numbers, booleans and JSON as themselves."""
    if kind.split("|")[0].strip() in ("integer", "number", "boolean", "object") or kind.endswith("[]"):
        try:
            return json.loads(value)
        except ValueError:
            pass
    return value


def manual_data(method: str, path: str, text: str, api: Any = None, prefill: bool = True) -> dict:
    """Try-it data for an ``api: "POST /v1/users"`` page: the page's ``<ParamField>``s (their
    ``placeholder``, else ``default``, as the example), each ``{param}`` in the path,
    ``api.server`` and an ``api.auth`` header."""
    from praisonaiui.compiler.agent_markdown import _TAG, FIELD_IN, _attrs
    from praisonaiui.compiler.docs_tags import _prose_segments
    params: list[dict] = []
    body: dict[str, Any] = {}
    prose = "".join(chunk for code, chunk in _prose_segments(text) if not code)
    for m in _TAG.finditer(prose):
        a = _attrs(m.group(3))
        where = next((k for k in FIELD_IN if k in a), None)
        if m.group(1) or m.group(2) != "ParamField" or not where or not a[where]:
            continue
        example, kind = a.get("placeholder") or a.get("default") or "", a.get("type") or "string"
        if where == "body":
            body.setdefault(a[where], _typed(kind, example) if example else "")
            continue
        params.append({"name": a[where], "in": where, "type": kind, **({"required": True} if a.get(
            "required", "false") != "false" or where == "path" else {}), **({"example": example} if example else {}),
                       **({"enum": ["true", "false"]} if kind == "boolean" else {})})
    for name in re.findall(r"\{([^{}/]+)\}", path):
        if not any(p["in"] == "path" and p["name"] == name for p in params):
            params.append({"name": name, "in": "path", "type": "string", "required": True})
    auth = getattr(api, "auth", None)
    if auth and auth.method in _AUTH:
        header, value = _AUTH[auth.method]
        params.append({"name": auth.name if auth.method == "key" and auth.name else header, "in": "header", "type": "string", "required": True,
                       "example": value})
    servers = getattr(api, "server", None) or []
    out: dict[str, Any] = {"method": method, "path": path, "prefill": prefill,
                           "servers": [{"url": u} for u in ([servers] if isinstance(servers, str) else servers)],
                           "params": params}
    if body:
        out["body"] = {"type": "application/json", "example": json.dumps(body, indent=2, ensure_ascii=False)}
    return out
