"""Page parameters, auto refresh, lazy sections and the status block (server pages)."""

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.server as srv
from praisonaiui import page_params


@pytest.fixture(autouse=True)
def _clean():
    srv.reset_state()
    yield
    srv.reset_state()


def _get(path):
    return TestClient(srv.create_app()).get(path)


def test_zero_arg_handler_still_works_and_ignores_the_query():
    srv.register_page("plain", title="Plain", handler=lambda: {"value": 1})
    assert _get("/api/pages/plain/data?x=1").json() == {"value": 1}


def test_params_keyword_handler_gets_query_with_lists_for_repeated_keys():
    seen = {}

    @aiui.page("filtered", title="Filtered")
    async def filtered(params):
        seen.update(params)
        return aiui.layout([aiui.text(params.get("channel", "all"))])

    body = _get("/api/pages/filtered/data?channel=foo&fmt=a&fmt=b").json()
    assert seen == {"channel": "foo", "fmt": ["a", "b"]}
    assert body["_components"][0]["content"] == "foo"


def test_signature_detection():
    calls = []
    srv.register_page("kw", title="K", handler=lambda **kw: calls.append(("kw", kw)) or {})
    srv.register_page("pos", title="P", handler=lambda p: calls.append(("pos", p)) or {})
    srv.register_page("dflt", title="D", handler=lambda limit=5: calls.append(("dflt", limit)) or {})
    client = TestClient(srv.create_app())
    for pid in ("kw", "pos", "dflt"):
        assert client.get(f"/api/pages/{pid}/data?a=1").status_code == 200
    assert calls == [("kw", {"params": {"a": "1"}}), ("pos", {"a": "1"}), ("dflt", 5)]


def test_refresh_every_from_registration_and_handler():
    @aiui.page("sync", title="Sync", refresh_every=5)
    def sync():
        return aiui.layout([])

    @aiui.page("own", title="Own", refresh_every=5)
    def own():
        return aiui.layout([], refresh_every=2)

    srv.register_page("none", title="None", handler=lambda: aiui.layout([]))
    client = TestClient(srv.create_app())
    assert client.get("/api/pages/sync/data").json()["_refresh_every"] == 5
    assert client.get("/api/pages/own/data").json()["_refresh_every"] == 2
    assert "_refresh_every" not in client.get("/api/pages/none/data").json()


def test_refresh_every_rejects_sub_second_and_reset_clears():
    with pytest.raises(ValueError):
        page_params.set_refresh_every("x", 0.5)
    with pytest.raises(ValueError):  # a rejected page is not half-registered
        srv.register_page("bad", title="Bad", refresh_every=0.5)
    assert "bad" not in srv._pages
    page_params.set_refresh_every("x", 3)
    srv.reset_state()
    assert page_params.with_refresh("x", {}) == {}


@pytest.mark.parametrize("path", ["/api/pages/p/data?a=1", "/api/pages/p/action"])
def test_page_endpoints_stay_auth_guarded(monkeypatch, path):
    from praisonaiui.features import auth as feature_auth

    monkeypatch.setitem(feature_auth._auth_config["api_keys"], "pk_params", {"name": "t"})
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    srv.register_page("p", title="P", handler=lambda params: {"ok": params})
    srv.register_page_action("p")(lambda data: data)
    client = TestClient(srv.create_app(), raise_server_exceptions=False)
    method = "POST" if path.endswith("action") else "GET"
    assert client.request(method, path, json={"_lazy": "x"}).status_code == 401
    ok = client.request(method, path, json={"_lazy": "x"}, headers={"Authorization": "Bearer pk_params"})
    assert ok.status_code == 200


def test_lazy_action_reply_contract():
    @srv.register_page_action("yt")
    def act(data):
        if data.get("_lazy") == "retention":
            return aiui.layout([aiui.text(f"days={data['_params'].get('days')}")])
        return {"message": "ok"}

    res = TestClient(srv.create_app()).post(
        "/api/pages/yt/action", json={"_lazy": "retention", "_params": {"days": "7"}}
    )
    assert res.json()["_components"][0]["content"] == "days=7"


def test_lazy_tabs_and_expander_shapes():
    assert aiui.tabs([{"label": "A"}]) == {"type": "tabs", "items": [{"label": "A"}]}
    assert aiui.tabs([{"label": "A"}], lazy=True)["lazy"] is True
    exp = aiui.expander("Retention", lazy=True)
    assert (exp["lazy"], exp["load"], exp["children"]) == (True, "Retention", [])
    assert "lazy" not in aiui.expander("T", children=[])
    assert aiui.expander("T", lazy=True, load="k")["load"] == "k"


def test_ui_helpers_shapes_are_additive():
    assert aiui.layout([]) == {"_components": []}
    assert aiui.layout([], params={"q": "x"})["_params"] == {"q": "x"}
    assert aiui.layout([], refresh_every=3)["_refresh_every"] == 3
    form = aiui.form("p", children=[])
    assert "method" not in form and "update_url" not in form
    assert aiui.form("p", children=[], method="GET")["method"] == "get"
    assert aiui.form("p", children=[], update_url=True)["update_url"] is True


def test_status_block():
    s = aiui.status("Sync", state="failed", detail="boom", progress=140, log=["a", 2])
    assert s == {
        "type": "status", "label": "Sync", "state": "failed", "detail": "boom",
        "progress": 100, "log": ["a", "2"],
    }
    assert aiui.status("Queued", state="queued") == {"type": "status", "label": "Queued", "state": "queued"}
    with pytest.raises(ValueError):
        aiui.status("x", state="weird")
