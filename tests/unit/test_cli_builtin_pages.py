"""`aiui plugins list/doctor` map each built-in page id to its owning record."""

from types import SimpleNamespace

from praisonaiui.builtin._plugin import BuiltinPlugin
from praisonaiui.cli import _builtin_pages_by_id
from praisonaiui.plugin_registry import PageSpec


def _rec(plugin):
    return SimpleNamespace(name=f"builtin.{plugin.name}", plugin=plugin)


def test_shell_only_layout_pages_show_their_owning_record():
    plugin = BuiltinPlugin(
        "layout-demo",
        "demo layout",
        page_specs=(
            PageSpec(id="demo-table", title="Table", kind="native"),
            PageSpec(id="demo-start", title="Start", kind="native", shell_only=True, layouts=("demo",)),
        ),
    )
    assert _builtin_pages_by_id([_rec(plugin)]) == {
        "demo-table": "builtin.layout-demo",
        "demo-start": "builtin.layout-demo",
    }


def test_a_plugin_without_shell_pages_still_lists_its_pages():
    plugin = SimpleNamespace(name="x", pages=lambda: [{"id": "p1"}])
    assert _builtin_pages_by_id([_rec(plugin)]) == {"p1": "builtin.x"}


def test_a_hook_that_raises_is_ignored():
    def boom():
        raise RuntimeError("broken")

    plugin = SimpleNamespace(name="y", pages=lambda: [{"id": "p2"}], shell_pages=boom)
    assert _builtin_pages_by_id([_rec(plugin)]) == {"p2": "builtin.y"}
