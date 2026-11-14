"""A custom theme accent must never break out of the dashboard <style> tag.

POST /api/theme/register stored any accent, and the default dashboard style
wrote it raw into <style id="aiui-server-theme">, so an accent containing
</style><script> ran for every visitor.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui.features import theme as theme_mod
from praisonaiui.server import create_app

PAYLOAD = "red}</style><script>alert(document.domain)</script><style>"


@pytest.fixture(autouse=True)
def _fresh_theme(monkeypatch):
    prev = srv._style
    monkeypatch.setattr(theme_mod, "_theme_manager", theme_mod.ThemeManager(), raising=False)
    yield
    srv._style = prev


def _client():
    return TestClient(create_app(), raise_server_exceptions=False)


def test_register_rejects_script_accent():
    c = _client()
    r = c.post("/api/theme/register", json={"name": "evil", "accent": PAYLOAD})
    assert r.status_code == 400
    assert c.put("/api/theme", json={"preset": "evil"}).status_code in (200, 400)
    html = srv._build_html("dashboard")
    assert "<script>alert(document.domain)</script>" not in html
    assert "evil" not in theme_mod.get_theme_manager().list_themes()


@pytest.mark.parametrize(
    "rgb",
    ["1,2,3);}</style><script>x()</script>", "300,0,0", "a,b,c"],
)
def test_register_rejects_bad_accent_rgb(rgb):
    r = _client().post(
        "/api/theme/register", json={"name": "evil-rgb", "accent": "#ff0000", "accentRgb": rgb}
    )
    assert r.status_code == 400


def test_python_api_rejects_script_accent():
    with pytest.raises(ValueError):
        theme_mod.get_theme_manager().register_theme("evil", {"accent": PAYLOAD})


def test_valid_custom_theme_still_reaches_dashboard_tag():
    c = _client()
    r = c.post("/api/theme/register", json={"name": "ocean", "accent": "#0077b6"})
    assert r.status_code == 200
    assert c.put("/api/theme", json={"preset": "ocean"}).status_code == 200
    html = srv._build_html("dashboard")
    assert "--db-accent:#0077b6!important" in html
    assert "--db-accent-rgb:0,119,182!important" in html


def test_dashboard_tag_drops_values_stored_behind_the_api(monkeypatch):
    mgr = theme_mod.get_theme_manager()
    # A value that bypassed validation (e.g. set directly) is dropped, not embedded.
    mgr._custom_themes["sneaky"] = {"accent": PAYLOAD, "accentRgb": PAYLOAD}
    mgr._current_preset = "sneaky"
    html = srv._build_html("dashboard")
    assert "<script>alert" not in html
    assert "</style><script>" not in html
