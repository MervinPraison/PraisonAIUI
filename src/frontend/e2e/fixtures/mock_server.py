"""Deterministic PraisonAIUI server for the Playwright suites.

It runs the real server (``create_app()``) with a scripted provider instead of
an LLM, so every wire event the chat UI handles can be produced on demand.

    python mock_server.py --port 8720 [--style chat] [--preset rose] [--plugin] [--custom-js]

Start it through ``start-server.mjs``, which sets ``AIUI_DATA_DIR`` (isolated),
``AIUI_TEMPLATES_DIR`` (the fresh build), ``PYTHONPATH`` and ``AIUI_SHELL``.

Keywords in the user's message select what the scripted run does:

    markdown  reply with a code block, a table, math and a mermaid diagram
    slow      300 tokens, 50 ms apart (gives Stop something to stop)
    ask       pause with a question and two options
    apok      pause for approval ``ap_ok`` (this server answers 200)
    ap500     pause for approval ``ap_500`` (this server answers 500)
    plain     reply with text only (no reasoning, tool, element or references)
    weather   call the get_weather tool (the example plugin renders it)

Without a keyword the run emits reasoning, one tool call with an image
element, references and a short markdown answer.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import uvicorn

import praisonaiui as aiui
from praisonaiui import server as srv
from praisonaiui.provider import BaseProvider, RunEvent, RunEventType

REPO_ROOT = Path(__file__).resolve().parents[4]
HELLO_PLUGIN = REPO_ROOT / "examples" / "plugins" / "aiui-hello-plugin"
CUSTOM_JS = Path(__file__).resolve().parent / "custom-js" / "custom.js"

# An image the page can always load (the chat only auto-loads same-origin,
# data:image/ and blob: URLs).
CHART_IMAGE = (
    "data:image/svg+xml;utf8,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E"
    "%3Crect width='120' height='60' fill='%2371717a'/%3E%3C/svg%3E"
)

MARKDOWN_REPLY = """## Markdown sample

Some **bold** text, `inline code` and a [link](https://example.com/docs).

```python
def greet(name: str) -> str:
    return f"hello {name}"
```

| Model | Tokens |
|---|---|
| alpha | 1200 |
| beta | 3400 |

Inline math $E = mc^2$ and a block:

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

```mermaid
flowchart LR
  A[Start] --> B[Finish]
```

![remote chart](https://images.example.invalid/chart.png?session=secret)
"""


class MockProvider(BaseProvider):
    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        text = str(message)
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Mock")

        if "plain" not in text:
            yield RunEvent(type=RunEventType.REASONING_STARTED)
            yield RunEvent(type=RunEventType.REASONING_STEP, step="Parse the request")
            yield RunEvent(type=RunEventType.REASONING_STEP, step="Decide to call a tool")
            yield RunEvent(type=RunEventType.REASONING_COMPLETED)
            yield RunEvent(
                type=RunEventType.TOOL_CALL_STARTED,
                name="web_search",
                args={"query": text},
                tool_call_id="tc_1",
            )
            await asyncio.sleep(0.05)
            yield RunEvent(
                type=RunEventType.TOOL_CALL_COMPLETED,
                name="web_search",
                args={"query": text},
                tool_call_id="tc_1",
                result={"hits": 2},
                extra_data={"elements": [{"type": "image", "url": CHART_IMAGE, "name": "chart"}]},
            )
            yield RunEvent(
                type=RunEventType.REFERENCES,
                query=text,
                references=[{"name": "doc.md", "content": "lorem", "chunk": 0, "chunk_size": 5}],
            )

        if "weather" in text:
            # The example plugin registers a renderer for this tool.
            yield RunEvent(
                type=RunEventType.TOOL_CALL_STARTED,
                name="get_weather",
                args={"city": "Paris"},
                tool_call_id="tc_weather",
            )
            await asyncio.sleep(0.05)
            yield RunEvent(
                type=RunEventType.TOOL_CALL_COMPLETED,
                name="get_weather",
                args={"city": "Paris"},
                tool_call_id="tc_weather",
                result={"city": "Paris", "temperature": 21, "conditions": "sunny"},
            )

        if "markdown" in text:
            final = MARKDOWN_REPLY
            tokens = [final[i : i + 24] for i in range(0, len(final), 24)]
            delay = 0.005
        elif "slow" in text:
            tokens = ["You ", "said: ", "**", text, "**\n\n"] + [f"w{i} " for i in range(1, 300)]
            final = "".join(tokens)
            delay = 0.05
        else:
            tokens = ["You ", "said: ", "**", text, "**\n\n", "```py\nprint(1)\n```"]
            final = "".join(tokens)
            delay = 0.02
        for tok in tokens:
            yield RunEvent(type=RunEventType.RUN_CONTENT, token=tok, agent_name="Mock")
            await asyncio.sleep(delay)

        if "ask" in text:
            yield RunEvent(
                type=RunEventType.RUN_PAUSED,
                extra_data={"question": "Pick one", "options": ["A", "B"]},
            )
        for keyword, approval_id in (("apok", "ap_ok"), ("ap500", "ap_500")):
            if keyword in text:
                yield RunEvent(
                    type=RunEventType.RUN_PAUSED,
                    extra_data={
                        "type": "approval_required",
                        "id": approval_id,
                        "tool_name": "shell",
                        "arguments": {"cmd": "ls"},
                        "risk_level": "high",
                        "tool_call_id": "tc_1",
                    },
                )
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content=final)


class ApprovalMock:
    """Answer the two scripted approval ids; everything else reaches the app.

    ``GET /__e2e/approval-posts`` lists the approval requests seen so far.
    """

    def __init__(self, app):
        self.app = app
        self.posts: list[str] = []

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope["path"]
            if path == "/__e2e/approval-posts":
                return await self._json(send, 200, {"posts": self.posts})
            if path.startswith("/api/approvals/ap_"):
                self.posts.append(f"{scope['method']} {path}")
            if path.startswith("/api/approvals/ap_ok/"):
                await asyncio.sleep(0.3)
                return await self._json(send, 200, {"ok": True})
            if path.startswith("/api/approvals/ap_500/"):
                return await self._json(send, 500, {"error": "boom"})
        return await self.app(scope, receive, send)

    @staticmethod
    async def _json(send, status, body):
        payload = json.dumps(body).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": payload})


def use_in_memory_stores() -> None:
    """Use the dependency-free memory and knowledge backends.

    With praisonaiagents installed, the server picks SDK backends on the first
    chat turn: a vector store that opens synchronously and an embedding call
    that waits on the network. That stalls the first reply for seconds, which
    made streaming tests time out. The UI under test does not depend on which
    backend stores the turn.
    """
    try:
        from praisonaiui.features import knowledge, memory
    except ImportError:
        return
    if hasattr(memory, "set_memory_manager") and hasattr(memory, "SimpleMemoryManager"):
        memory.set_memory_manager(memory.SimpleMemoryManager())
    if hasattr(knowledge, "_knowledge_manager") and hasattr(knowledge, "SimpleKnowledgeManager"):
        knowledge._knowledge_manager = knowledge.SimpleKnowledgeManager()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument(
        "--style", default=None, help="set_style() value; default leaves the server default"
    )
    parser.add_argument("--preset", default=None, help="theme preset for set_theme()")
    parser.add_argument(
        "--plugin", action="store_true", help="register the example hello plugin in-process"
    )
    parser.add_argument(
        "--custom-js",
        action="store_true",
        help="set_custom_js() with a registerView for 'client-view', a page that also has a server handler",
    )
    args = parser.parse_args()

    if "AIUI_DATA_DIR" not in os.environ:
        sys.exit(
            "mock_server.py: set AIUI_DATA_DIR to an empty temp directory (start-server.mjs does)"
        )

    srv.set_provider(MockProvider())
    use_in_memory_stores()
    if args.style:
        aiui.set_style(args.style)
    if args.preset:
        aiui.set_theme(preset=args.preset)
    if args.plugin:
        sys.path.insert(0, str(HELLO_PLUGIN))
        from aiui_hello import plugin

        aiui.register_plugin(plugin)
    if args.custom_js:
        # A handler page (kind=blocks under the app shell) whose client view in
        # custom.js must take priority, as in the legacy dashboard.
        async def client_view_fallback() -> dict:
            return {"_components": [{"type": "text", "content": "Server fallback: plugin not loaded"}]}

        aiui.register_page(
            "client-view",
            title="Client view",
            icon="🧩",
            handler=client_view_fallback,
        )
        aiui.set_custom_js(CUSTOM_JS)

    app = ApprovalMock(srv.create_app())
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
