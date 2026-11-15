"""Layout-gated built-ins (ADR 0003, R17.5).

A built-in with ``for_layouts`` mounts only while one of those layouts is
available, or while ``extensions.enabled`` names it. Otherwise its record is
``disabled`` ("no layout needs it"), its routes are not mounted and its
feature module is never imported. The record here stands in for
``builtin.run-ledger`` (``for_layouts=("command", "mission")``).
"""

from __future__ import annotations

import sys
import textwrap

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui.builtin import BuiltinPlugin, feature
from praisonaiui.plugin_registry import get_plugin_registry, set_extensions

MODULE = "aiui_test_layout_gated_ledger"
RECORD = "builtin.test-ledger"
ROUTE = "/api/test-ledger/ping"

FEATURE_SRC = textwrap.dedent(
    """
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    from praisonaiui.features._base import BaseFeatureProtocol


    async def _ping(request):
        return JSONResponse({"ok": True})


    class LedgerFeature(BaseFeatureProtocol):
        feature_name = "test-ledger"
        feature_description = "Layout-gated test feature"

        @property
        def name(self):
            return self.feature_name

        @property
        def description(self):
            return self.feature_description

        def routes(self):
            return [Route("/api/test-ledger/ping", _ping, methods=["GET"])]
    """
)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.delenv("AIUI_LAYOUT", raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    mods = tmp_path / "mods"
    mods.mkdir()
    (mods / f"{MODULE}.py").write_text(FEATURE_SRC, encoding="utf-8")
    monkeypatch.syspath_prepend(str(mods))
    sys.modules.pop(MODULE, None)
    srv.reset_state()
    get_plugin_registry().register_builtin(
        BuiltinPlugin(
            "test-ledger",
            "Runs ledger stand-in",
            feature_refs=(feature(MODULE, "LedgerFeature"),),
            for_layouts=("command", "mission"),
        )
    )
    yield data
    srv.reset_state()
    import praisonaiui.features as features

    features._features.pop("test-ledger", None)
    features._builtin_registered.pop("test-ledger", None)
    sys.modules.pop(MODULE, None)


def _client(style: str = "app", **cfg) -> TestClient:
    srv.set_style(style)
    return TestClient(srv.create_app(config=cfg or None))


def _record(client: TestClient) -> dict:
    rows = client.get("/api/plugins?origin=builtin").json()["plugins"]
    return next(r for r in rows if r["name"] == RECORD)


def _assert_off(client: TestClient) -> None:
    assert MODULE not in sys.modules
    assert client.get(ROUTE).status_code == 404
    rec = _record(client)
    assert rec["status"] == "disabled" and rec["reason"] == "no layout needs it"


def _assert_on(client: TestClient) -> None:
    assert MODULE in sys.modules
    assert client.get(ROUTE).json() == {"ok": True}
    rec = _record(client)
    assert rec["status"] == "ok" and "reason" not in rec


def test_only_chat_canvas_available_leaves_it_unmounted_and_unimported():
    aiui.set_layout(available=["chat-canvas"])
    _assert_off(_client())


def test_a_listed_layout_on_offer_mounts_it():
    aiui.set_layout(available=["chat-canvas", "mission"])
    _assert_on(_client())


def test_every_layout_on_offer_by_default_mounts_it():
    _assert_on(_client())


def test_explicit_enable_mounts_it_without_a_layout():
    aiui.set_layout(available=["chat-canvas"])
    _assert_on(_client(extensions={"enabled": [RECORD]}))


def test_disabled_always_wins():
    set_extensions(disabled=[RECORD])
    client = _client()
    assert MODULE not in sys.modules and client.get(ROUTE).status_code == 404
    rec = _record(client)
    assert rec["status"] == "disabled" and "reason" not in rec


def test_disabling_the_layouts_it_serves_unmounts_it():
    _assert_off(_client(extensions={"disabled": ["builtin.layout-command", "builtin.layout-mission"]}))


@pytest.mark.parametrize("style", ["dashboard", "chat"])
def test_no_layouts_outside_style_app(style):
    _assert_off(_client(style))


def test_a_later_create_app_unmounts_it_again():
    _assert_on(_client())
    aiui.set_layout(available=["workbench"])
    client = TestClient(srv.create_app())
    assert client.get(ROUTE).status_code == 404
    assert _record(client)["status"] == "disabled"
