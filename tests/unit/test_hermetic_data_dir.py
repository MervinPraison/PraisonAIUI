"""Test runs never touch the developer's real data folder.

tests/conftest.py points AIUI_DATA_DIR at a fresh temporary folder before any
praisonaiui module is imported, and clears PRAISONAI_HOME (which outranks it).
Without that, a local run read and wrote ~/.praisonaiui (schedules, channels,
sessions, config.yaml), and two runs at once collided.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_REAL_HOME_DATA = Path.home() / ".praisonaiui"
_OPTED_OUT = os.environ.get("AIUI_TESTS_REAL_DATA_DIR", "").lower() in ("1", "true", "yes")

pytestmark = pytest.mark.skipif(_OPTED_OUT, reason="AIUI_TESTS_REAL_DATA_DIR=1 opts out")


def test_data_dir_is_a_temporary_folder():
    data_dir = Path(os.environ["AIUI_DATA_DIR"]).resolve()
    assert data_dir != _REAL_HOME_DATA.resolve()
    assert str(data_dir).startswith(str(Path(tempfile.gettempdir()).resolve()))
    assert data_dir.name.startswith("aiui-tests-")


def test_praisonai_home_does_not_point_at_real_data():
    home = os.environ.get("PRAISONAI_HOME")
    assert home is None or Path(home).resolve() != _REAL_HOME_DATA.resolve()


def test_config_store_default_follows_the_test_folder():
    from praisonaiui import config_store

    assert config_store.DEFAULT_CONFIG_DIR == Path(os.environ["AIUI_DATA_DIR"])
    assert config_store._get_default_config_dir() == Path(os.environ["AIUI_DATA_DIR"])


def test_feature_data_stays_in_a_temporary_folder():
    """Feature data resolves to a temporary folder, never ~/.praisonaiui.

    Not necessarily AIUI_DATA_DIR itself: create_app copies AIUI_DATA_DIR into
    PRAISONAI_HOME (setdefault), so after a test that pointed AIUI_DATA_DIR at
    its own tmp_path, PRAISONAI_HOME keeps that (also temporary) folder.
    """
    from praisonaiui.features._paths import configured_data_dir, feature_data_path

    tmp_root = Path(tempfile.gettempdir()).resolve()
    base = configured_data_dir()
    assert base is not None
    assert base.resolve() != _REAL_HOME_DATA.resolve()
    assert str(base.resolve()).startswith(str(tmp_root))
    assert feature_data_path("traces", Path("/legacy")) == base / "traces"


def test_gateway_config_store_honours_aiui_data_dir():
    """integration.py used Path.home() / '.praisonaiui' and ignored AIUI_DATA_DIR."""
    import inspect

    from praisonaiui import integration

    src = inspect.getsource(integration)
    assert 'Path.home() / ".praisonaiui"' not in src
    assert "_get_default_config_dir()" in src
