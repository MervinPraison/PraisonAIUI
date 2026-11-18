"""Everything shipped has a catalog record, and ARCHITECTURE.md counts match.

R2: every shipped page and feature is a ``BuiltinPlugin`` record, so
``extensions.disabled`` can switch it off. R16: the numbers ARCHITECTURE.md
states are the numbers on ``main``.
"""

from __future__ import annotations

import importlib
import inspect
import pkgutil
import re
import warnings
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.config_store as config_store
import praisonaiui.features as features_pkg
import praisonaiui.server as srv
from praisonaiui.builtin import BUILTIN_PLUGINS
from praisonaiui.features._base import BaseFeatureProtocol
from praisonaiui.plugin_registry import set_extensions

ROOT = Path(__file__).resolve().parents[2]
BUNDLED_FOLDERS = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "dashboard-plugins"

#: Feature classes that ship but are mounted by no record, and why. Adding to
#: this list needs the same justification in review.
UNMOUNTED_FEATURES = {
    # Deprecated: nothing in the browser posts to their routes (R7 shims warn).
    ("window_message", "WindowMessageFeature"),
    ("audio", "AudioFeature"),
    # The startup/shutdown hooks run from the server lifespan; only the
    # class's status routes are unmounted.
    ("lifecycle", "LifecycleFeature"),
}


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield
    srv.reset_state()


def test_every_bundled_dashboard_plugin_folder_belongs_to_a_record():
    folders = {p.name for p in BUNDLED_FOLDERS.iterdir() if (p / "manifest.json").is_file()}
    claimed = {name for p in BUILTIN_PLUGINS for name in p.dashboard_plugins}
    assert folders and folders <= claimed, sorted(folders - claimed)


def test_disabling_builtin_examples_removes_the_sample_board():
    client = TestClient(srv.create_app())
    assert "sample-board" in {p["id"] for p in client.get("/api/pages").json()["pages"]}

    srv.reset_state()
    set_extensions(disabled=["builtin.examples"])
    client = TestClient(srv.create_app())
    assert "sample-board" not in {p["id"] for p in client.get("/api/pages").json()["pages"]}
    assert "sample-board" not in {
        p["id"] for p in client.get("/api/shell/manifest").json()["pages"]
    }
    folders = {p["name"] for p in client.get("/api/dashboard/plugins").json()["plugins"]}
    assert "sample-board" not in folders and "kanban" in folders
    assert client.get("/dashboard-plugins/sample-board/index.js").status_code == 404


def _feature_classes() -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for info in pkgutil.iter_modules(features_pkg.__path__):
        mod = importlib.import_module(f"praisonaiui.features.{info.name}")
        for name, obj in vars(mod).items():
            if (
                inspect.isclass(obj)
                and issubclass(obj, BaseFeatureProtocol)
                and obj is not BaseFeatureProtocol
                and obj.__module__ == mod.__name__
                and name == obj.__name__
            ):
                found.add((info.name, name))
    return found


def test_every_feature_class_is_owned_by_a_catalog_record():
    refs = {(r.module.lstrip("."), r.cls) for p in BUILTIN_PLUGINS for r in p.feature_refs}
    classes = _feature_classes()
    assert classes - refs == UNMOUNTED_FEATURES
    assert not (UNMOUNTED_FEATURES & refs)  # an entry here must not also be mounted


@pytest.mark.parametrize(
    "name, canonical",
    [
        ("on_window_message", "on_window_message"),
        ("on_parent_message", "on_window_message"),
        ("on_audio_start", "on_audio_start"),
        ("on_audio_chunk", "on_audio_chunk"),
        ("on_audio_end", "on_audio_end"),
        ("on_mic_start", "on_audio_start"),
        ("on_mic_data", "on_audio_chunk"),
        ("on_mic_stop", "on_audio_end"),
    ],
)
def test_unwired_hooks_warn_when_used(name, canonical):
    hook = getattr(aiui, name)  # importing stays quiet; using it warns
    with pytest.warns(DeprecationWarning, match=f"aiui.{canonical} is deprecated"):
        if canonical == "on_window_message":
            hook()(lambda data: None)
        else:
            hook(lambda *a: None)


def test_send_window_message_warns_when_used():
    import asyncio

    with pytest.warns(DeprecationWarning, match="aiui.send_window_message is deprecated"):
        asyncio.run(aiui.send_to_parent({"x": 1}))


def test_star_import_does_not_warn():
    with warnings.catch_warnings():
        warnings.simplefilter("error", DeprecationWarning)
        exec("from praisonaiui import *", {})


def test_live_lifecycle_hooks_do_not_warn():
    with warnings.catch_warnings():
        warnings.simplefilter("error", DeprecationWarning)
        assert callable(aiui.on_app_startup)
        assert callable(aiui.on_startup)


# ── ARCHITECTURE.md (R16; the catalog and SDK counts are in
#    test_architecture_counts.py) ────────────────────────────────────

ARCH = (ROOT / "ARCHITECTURE.md").read_text(encoding="utf-8")


def test_architecture_counts_the_legacy_view_files():
    m = re.search(r"`plugins/views/\*\.js` \((\d+) files", ARCH)
    assert m
    views = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "views"
    assert int(m.group(1)) == len(list(views.glob("*.js")))


def test_no_shipped_layout_feature_is_marked_planned():
    lf = ROOT / "src" / "frontend" / "src" / "layout-features"
    for name in (p.name for p in lf.iterdir() if p.is_dir()):
        assert f"`lf-{name}` **(planned" not in ARCH, name
