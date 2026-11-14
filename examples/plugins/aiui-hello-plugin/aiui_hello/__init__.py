"""aiui-hello-plugin: the smallest complete PraisonAIUI plugin.

It contributes, to the React app shell (``style: app`` or ``AIUI_SHELL=app``):

* ``/hello`` — a React page (``static/hello.js``, plain ESM, no build step)
  that uses the shell's own React through the import map;
* ``/hello-blocks`` — a server-driven blocks page served by :meth:`routes`;
* a ``hello_badge`` block type (rendered by ``hello.js``) that any blocks page
  can use;
* a renderer for the ``get_weather`` tool call in chat;
* a ``Hello`` sidebar group for both pages (:meth:`nav_groups`);
* a "Hello plugin" section in the shell's settings dialog (:meth:`settings`),
  whose greeting the blocks page uses;
* a "Sunrise" theme preset (:meth:`themes`), picked in the command palette;
* an ``aiui hello greet NAME`` command.

Install it next to praisonaiui (``pip install -e examples/plugins/aiui-hello-plugin``)
and run ``aiui plugins doctor``.
"""

from __future__ import annotations

import itertools
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from praisonaiui.plugin_registry import (
    BlockSpec,
    NavGroupSpec,
    SettingsField,
    SettingsSectionSpec,
    ThemeSpec,
    ToolRendererSpec,
    get_plugin_settings,
)

__all__ = ["HelloPlugin", "plugin"]
__version__ = "0.1.0"

_STATIC = Path(__file__).parent / "static"
_greetings = itertools.count(1)


def _blocks(greeting: str | None = None, count: int = 0) -> dict:
    """The hello-blocks page as a ``_components`` tree (same dicts as aiui.ui)."""
    components: list[dict] = [
        {"type": "header", "text": "Hello from a plugin", "level": 2},
        {
            "type": "text",
            "content": (
                "This page is served by the aiui-hello-plugin package. Its routes() return "
                "this block tree, and the shell renders it with core blocks."
            ),
        },
        {
            "type": "stat_group",
            "stats": [
                {"label": "Greetings sent", "value": count, "delta": "+1" if count else ""},
                {"label": "Surfaces", "value": 5},
                {"label": "Build step", "value": "none"},
            ],
        },
        {
            "type": "columns",
            "children": [
                {"type": "card", "title": "Entry point", "value": "hello", "footer": "praisonaiui.plugins"},
                {"type": "card", "title": "Static files", "value": "/_plugins/hello/", "footer": "sha384 SRI"},
            ],
        },
        {
            "type": "table",
            "headers": ["Surface", "Where", "Kind"],
            "rows": [
                ["React page", "/hello", "react"],
                ["Blocks page", "/hello-blocks", "blocks"],
                ["Block", "hello_badge", "block"],
                ["Tool renderer", "get_weather", "toolRenderer"],
                ["CLI", "aiui hello greet", "typer"],
            ],
        },
        {"type": "progress_bar", "label": "Plugin checklist", "value": 5, "max_value": 5},
        # A block type contributed by this plugin (hello.js registerBlock).
        {"type": "hello_badge", "text": "Rendered by the plugin's own block"},
        {
            "type": "button_group",
            "buttons": [{"label": "Say hello", "variant": "primary", "action": "greet"}],
        },
    ]
    if greeting:
        components.append({"type": "alert", "variant": "success", "title": "Server says", "message": greeting})
    # Not a core block: rendered by the legacy dashboard renderer (fallback).
    components.append(
        {"type": "chart", "title": "Legacy-rendered block", "data": [{"x": 1}, {"x": 2}], "chart_type": "bar"}
    )
    return {"_components": components}


async def _hello_blocks(request: Request) -> JSONResponse:
    return JSONResponse(_blocks())


async def _hello_blocks_action(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict) or body.get("action") != "greet":
        return JSONResponse({"error": "unknown action"}, status_code=400)
    n = next(_greetings)
    # Values from the shell's settings dialog (defaults until someone saves).
    prefs = get_plugin_settings("hello", "greeting")
    end = "!" if prefs.get("tone") == "excited" else "."
    text = f"{prefs.get('greeting') or 'Hello'} #{n} from Python{end}"
    return JSONResponse({**_blocks(text, n), "message": f"Greeting #{n} sent"})


class HelloPlugin:
    """Duck-typed plugin (see praisonaiui.plugin_registry.AiuiPlugin)."""

    name = "hello"
    version = __version__
    sdk = 1  # browser SDK major version this plugin targets

    def pages(self):
        # Dicts use PageSpec field names; PageSpec(...) objects work too.
        return [
            {
                "id": "hello",
                "title": "Hello",
                "kind": "react",
                "module": "hello.js",  # relative → /_plugins/hello/hello.js (+ sha384 integrity)
                "icon": "plug",  # a lucide name the shell maps (or an emoji)
                "group": "Hello",  # declared in nav_groups()
                "order": 900,
                "description": "A React page from a plugin",
            },
            {
                "id": "hello-blocks",
                "title": "Hello blocks",
                "kind": "blocks",  # data: GET /api/plugins/hello/pages/hello-blocks
                "icon": "layout-dashboard",
                "group": "Hello",
                "order": 901,
                "description": "A server-driven blocks page from a plugin",
            },
        ]

    def nav_groups(self):
        # The sidebar group both pages use. 250 sits between the app's second
        # and third groups (its layout.groups.order is at 100, 200, 300).
        return [NavGroupSpec(name="Hello", order=250)]

    def settings(self):
        # Rendered by the shell's settings dialog; saved values come back
        # through get_plugin_settings("hello", "greeting").
        return [
            SettingsSectionSpec(
                id="greeting",
                title="Hello plugin",
                description="How the Hello blocks page greets you.",
                fields=(
                    SettingsField(key="greeting", label="Greeting", default="Hello",
                                  description="The word the Say hello button uses."),
                    SettingsField(key="tone", label="Tone", type="select",
                                  options=({"value": "plain", "label": "Plain"},
                                           {"value": "excited", "label": "Excited"})),
                ),
            )
        ]

    def themes(self):
        # Seed tokens only: the shell derives every other colour from them.
        return [
            ThemeSpec(
                id="sunrise",
                label="Sunrise",
                light={"--seed-accent": "#c2410c", "--seed-tint": "#78716c"},
                dark={"--seed-accent": "#fb923c", "--seed-tint": "#78716c"},
            )
        ]

    def blocks(self):
        # hello.js registers this block type itself through @aiui/sdk.
        return [BlockSpec(type="hello_badge", module="hello.js")]

    def tool_renderers(self):
        # hello.js registers this renderer itself through @aiui/sdk.
        return [ToolRendererSpec(tool_name="get_weather", module="hello.js")]

    def routes(self):
        # Mounted under /api/plugins/hello
        return [
            Route("/pages/hello-blocks", _hello_blocks, methods=["GET"]),
            Route("/pages/hello-blocks/action", _hello_blocks_action, methods=["POST"]),
        ]

    def static_dir(self):
        return _STATIC  # served at /_plugins/hello/

    def cli_commands(self):
        import typer

        cli = typer.Typer(help="Commands from aiui-hello-plugin", add_completion=False)

        @cli.command()
        def greet(name: str = typer.Argument("world")) -> None:
            """Print a greeting."""
            typer.echo(f"Hello, {name}! (from aiui-hello-plugin {__version__})")

        @cli.command()
        def info() -> None:
            """Show where the plugin's files are."""
            typer.echo(f"static: {_STATIC}")

        return cli


plugin = HelloPlugin()
