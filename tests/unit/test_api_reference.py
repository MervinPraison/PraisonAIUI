"""GET /api/openapi.json: the server's own OpenAPI document (builtin.api-reference).

Built from the live route table, so every API route the server answers is in
it, a disabled record's routes are not, a plugin's routes join with its name
as the tag, and a plugin the caller may not use stays out. The route needs
credentials in every auth mode.
"""

from __future__ import annotations

import json

import pytest
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route, Router
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui import config_store
from praisonaiui.features.openapi import _texts, build_spec
from praisonaiui.plugin_registry import register_plugin, set_extensions


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield
    srv.reset_state()


def _spec(app) -> dict:
    res = TestClient(app).get("/api/openapi.json")
    assert res.status_code == 200
    return res.json()


def _ops(spec: dict) -> set[tuple[str, str]]:
    return {(m.upper(), p) for p, item in spec["paths"].items() for m in item}


def test_every_api_route_is_in_the_document():
    app = srv.create_app()
    spec = _spec(app)
    assert spec["openapi"] == "3.1.0" and spec["servers"] == [{"url": "/"}]
    ops = _ops(spec)
    for route in app.routes:
        if isinstance(route, Route) and route.path.startswith(("/api/", "/v1")):
            for method in route.methods or ():
                if method != "HEAD":
                    path = route.path.replace(":path}", "}")
                    assert (method, path) in ops, (method, route.path)
    # Pages and static files are not API routes.
    assert "/" not in spec["paths"] and "/{path}" not in spec["paths"]
    assert not any(p.startswith(("/assets/", "/plugins/")) for p in spec["paths"])
    assert {w["path"] for w in spec["x-websockets"]} >= {"/api/chat/ws", "/api/logs/stream"}


def test_operations_carry_tags_params_security_and_feature_extras():
    spec = _spec(srv.create_app())
    sessions = spec["paths"]["/api/sessions"]["get"]
    assert sessions["tags"] == ["sessions"] and sessions["summary"]
    assert {"name": "sessions", "description": "Conversation sessions and the run timeline"} in spec["tags"]
    param = spec["paths"]["/v1/models/{model_id}"]["get"]["parameters"][0]
    assert param == {"name": "model_id", "in": "path", "required": True, "schema": {"type": "string"}}
    # Public surface: no credentials; everything else: the bearer scheme.
    assert spec["paths"]["/api/health"]["get"]["security"] == []
    assert "security" not in sessions and spec["security"] == [{"bearerAuth": []}]
    # A feature's openapi() hook adds the request body (the explorer's example).
    chat = spec["paths"]["/v1/chat/completions"]["post"]
    assert chat["tags"] == ["api"] and chat["summary"] == "OpenAI-compatible chat completions"
    assert chat["requestBody"]["content"]["application/json"]["example"]["messages"]
    ids = [op["operationId"] for item in spec["paths"].values() for op in item.values()]
    assert len(ids) == len(set(ids))


def test_the_document_passes_the_docs_site_checks(tmp_path):
    from praisonaiui.compiler.openapi import load_spec

    f = tmp_path / "aiui.json"
    f.write_text(json.dumps(_spec(srv.create_app())))
    assert load_spec(str(f)).issues == []


def test_docstring_summary_drops_the_method_and_path():
    async def handler(request):
        """POST /api/things/{id} — Make a thing.

        Body: ``{"name": ...}``.
        """

    async def api_list_things(request):
        pass

    assert _texts(handler) == ("Make a thing", 'Body: ``{"name": ...}``.')
    assert _texts(api_list_things) == ("List things", "")


def test_disabled_record_has_no_route_and_no_page():
    set_extensions(disabled=["builtin.api-reference"])
    client = TestClient(srv.create_app())
    assert client.get("/api/openapi.json").status_code == 404
    set_extensions(disabled=["builtin.debug"])
    spec = _spec(srv.create_app())
    assert "/api/openapi.json" in spec["paths"] and "/api/debug" not in spec["paths"]


def test_plugin_routes_join_under_the_plugins_name():
    async def hello(request):
        """Say hello."""
        return JSONResponse({"hi": True})

    class Hello:
        name = "hello-openapi"

        def routes(self):
            return [Route("/greet", hello, methods=["GET"])]

    register_plugin(Hello())
    op = _spec(srv.create_app())["paths"]["/api/plugins/hello-openapi/greet"]["get"]
    assert op["tags"] == ["hello-openapi"] and op["summary"] == "Say hello"


def test_a_plugin_the_caller_may_not_use_is_left_out():
    class Registry:
        def js_allowed(self, rec, *, restricted):
            return not restricted

    class Gated:  # the shape of plugin_registry._GatedStatic
        def __init__(self, restricted):
            self.registry, self.rec = Registry(), type("Rec", (), {"name": "secret"})()
            self.is_restricted = lambda scope: restricted
            self.app = Router(routes=[Route("/data", lambda r: None, methods=["GET"])])

    for restricted, listed in ((True, False), (False, True)):
        app = Router(routes=[Mount("/api/plugins/secret", app=Gated(restricted))])
        assert ("/api/plugins/secret/data" in build_spec(app)["paths"]) is listed


@pytest.mark.parametrize("mode", ["enforce", "require_auth", "token"])
def test_the_document_needs_credentials_in_every_auth_mode(monkeypatch, mode):
    if mode == "enforce":
        monkeypatch.setenv("AUTH_ENFORCE", "true")
        app = srv.create_app()
    elif mode == "token":
        monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
        monkeypatch.setenv("AIUI_URL_TOKEN", "s3cret")
        app = srv.create_app()
    else:
        app = srv.create_app(require_auth=True)
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/api/openapi.json").status_code == 401
    if mode == "token":
        ok = client.get("/api/openapi.json", headers={"Authorization": "Bearer s3cret"})
        assert ok.status_code == 200 and "/api/openapi.json" in ok.json()["paths"]
