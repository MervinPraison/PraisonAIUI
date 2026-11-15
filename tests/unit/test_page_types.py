"""Page templates (``praisonaiui.builtin.page_types``).

Every built-in page names one Pro page template; the table is data only, so
it is checked against the catalog records, never against a page list of its
own.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pytest

from praisonaiui.builtin import BUILTIN_PLUGINS
from praisonaiui.builtin import page_types as pt

#: Shell-only layout pages planned in ADR 0003 that tracks after this one ship.
PLANNED_SHELL_PAGES = {"start", "templates", "ops-overview", "artifacts"}


def _builtin_page_ids() -> list[str]:
    ids: list[str] = []
    for rec in BUILTIN_PLUGINS:
        ids.extend(s.id for s in rec.pages())
        ids.extend(s.id for s in rec.shell_pages())
    return ids


def test_every_builtin_page_has_a_template():
    missing = [pid for pid in _builtin_page_ids() if pid not in pt.PAGE_TYPE_BY_ID]
    assert missing == [], f"add these pages to PAGE_TYPE_BY_ID: {missing}"


def test_the_table_lists_only_builtin_pages():
    known = set(_builtin_page_ids()) | PLANNED_SHELL_PAGES
    stray = sorted(set(pt.PAGE_TYPE_BY_ID) - known)
    assert stray == [], f"not a built-in page: {stray}"


def test_every_template_is_a_styled_page_type():
    assert set(pt.PAGE_TYPE_BY_ID.values()) <= set(pt.PAGE_TYPES)
    # Each styled template is used by at least one built-in page.
    assert set(pt.PAGE_TYPES) == set(pt.PAGE_TYPE_BY_ID.values())


@pytest.mark.parametrize(
    ("page_id", "template"),
    [
        ("sessions", "list"),
        ("agents", "list"),
        ("skills", "list"),
        ("memory", "list"),
        ("knowledge", "list"),
        ("kanban", "board"),
        ("jobs-board", "board"),
        ("logs", "log"),
        ("debug", "log"),
        ("traces", "log"),
        ("code-studio", "editor"),
        ("marketplace", "gallery"),
        ("theme-picker", "gallery"),
        ("templates", "gallery"),
        ("overview", "overview"),
        ("config", "settings"),
    ],
)
def test_plan_templates(page_id, template):
    assert pt.page_type_for(page_id) == template


def test_table_is_read_only():
    with pytest.raises(TypeError):
        pt.PAGE_TYPE_BY_ID["sessions"] = "board"  # type: ignore[index]


@pytest.mark.parametrize("value", ["list", "my-type", "a", "x" * 40, None])
def test_validate_accepts(value):
    assert pt.validate_page_type(value) == value


@pytest.mark.parametrize("value", ["", "List", "1list", "x" * 41, "a b", 3, ["list"]])
def test_validate_rejects(value):
    with pytest.raises(ValueError):
        pt.validate_page_type(value)


@dataclass(frozen=True)
class _Spec:
    id: str
    page_type: Optional[str] = None


@dataclass(frozen=True)
class _NoField:
    id: str


def test_apply_fills_the_builtin_template():
    assert pt.apply_page_type(_Spec("logs")).page_type == "log"


def test_apply_keeps_a_declared_template():
    spec = _Spec("logs", page_type="board")
    assert pt.apply_page_type(spec) is spec


def test_apply_leaves_unknown_pages_and_specs_without_the_field():
    spec = _Spec("my-plugin-page")
    assert pt.apply_page_type(spec) is spec
    plain = _NoField("logs")
    assert pt.apply_page_type(plain) is plain
    assert pt.apply_page_type({"id": "logs"}) == {"id": "logs"}


def test_apply_rejects_an_invalid_declared_template():
    with pytest.raises(ValueError):
        pt.apply_page_type(_Spec("logs", page_type="Not Valid"))


def test_shell_row_fields():
    assert pt.shell_row_fields(_Spec("kanban")) == {"pageType": "board"}
    assert pt.shell_row_fields(_Spec("kanban", page_type="list")) == {"pageType": "list"}
    assert pt.shell_row_fields(_NoField("logs")) == {"pageType": "log"}
    assert pt.shell_row_fields(_Spec("my-plugin-page")) == {}


def test_importing_page_types_pulls_in_nothing_heavy():
    import subprocess
    import sys

    code = (
        "import sys; import praisonaiui.builtin.page_types; "
        "print(','.join(m for m in ('starlette','uvicorn','praisonaiui.server') if m in sys.modules))"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == ""
