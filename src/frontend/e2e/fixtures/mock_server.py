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
    cbfail    a real ``@reply`` callback (callback mode) streams one token
              and raises
    cbask     a real ``@reply`` callback asks "Pick one" (A or B) with
              ``aiui.ask`` and then says which was picked
    cbmulti   a real ``@reply`` callback pops a toast (``aiui.notify``) and
              sends three messages: one plain, one by "Helper" with an
              image (``add_image``), one streamed and then finalized

The exact message ``Compare sorting algorithms`` (or one containing
``sortdemo``) runs the layouts' design fixture (ADR 0003 plan §5.1): 2 s of
reasoning, the ``python3 --version`` tool (0.3 s), a comparison table, a
code block titled ``sort_demo.py``, an approval gate on ``pip install numpy``
(``ap_numpy``, answered 200) and follow-up suggestions.

Without a keyword the run emits reasoning, one tool call with an image
element, references and a short markdown answer.

``AIUI_E2E_SEED=design`` also seeds the chats the layout designs list
beside the sorting one (``DESIGN_SESSIONS``) before the server starts.
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


SORTING_PROMPT = "Compare sorting algorithms"

SORTING_INTRO = (
    "Here is how the three common general-purpose sorts compare. All three "
    "average O(n log n); they differ in the worst case, memory and stability.\n\n"
)

SORTING_TABLE = """| Algorithm | Average | Worst | Memory | Stable |
|---|---|---|---|---|
| Quicksort | O(n log n) | O(n²) | O(log n) | No |
| Mergesort | O(n log n) | O(n log n) | O(n) | Yes |
| Timsort | O(n log n) | O(n log n) | O(n) | Yes |

"""

SORTING_CODE = """A small script to time them on your machine:

```python title=sort_demo.py
import random
import time


def quicksort(xs):
    if len(xs) <= 1:
        return xs
    pivot, *rest = xs
    return quicksort([x for x in rest if x < pivot]) + [pivot] + quicksort([x for x in rest if x >= pivot])


def mergesort(xs):
    if len(xs) <= 1:
        return xs
    mid = len(xs) // 2
    left, right = mergesort(xs[:mid]), mergesort(xs[mid:])
    out = []
    while left and right:
        out.append(left.pop(0) if left[0] <= right[0] else right.pop(0))
    return out + left + right


data = [random.random() for _ in range(10_000)]
for name, fn in (("quicksort", quicksort), ("mergesort", mergesort), ("timsort", sorted)):
    t0 = time.perf_counter()
    fn(list(data))
    print(f"{name:10s} {time.perf_counter() - t0:.3f}s")
```

To benchmark on a million items I would like to install numpy.
"""

SORTING_SUGGESTIONS = [
    "Benchmark them on 1M items",
    "Explain why timsort is stable",
    "Add heapsort to the table",
]

#: The chats the layout designs list beside "Compare sorting algorithms".
DESIGN_SESSIONS = [
    ("Quick: summarise release notes", "Summarise the release notes for 0.3.154", "Three changes stand out: layouts, page templates and the run ledger."),
    ("Quick: draft a reply to Sam", "Draft a short reply to Sam about Friday", "Hi Sam, Friday works for me. Shall we say 10:00?"),
    ("Quick: weekly metrics", "Show the weekly metrics", "| Metric | This week | Last week |\n|---|---|---|\n| Runs | 412 | 380 |\n| Success | 97% | 95% |"),
]


def _is_sorting_demo(text: str) -> bool:
    return text.strip() == SORTING_PROMPT or "sortdemo" in text


async def sorting_demo(agent: str = "Researcher"):
    """The design fixture: reasoning, a tool, a table, code, a gate, suggestions."""
    yield RunEvent(type=RunEventType.RUN_STARTED, agent_name=agent)
    yield RunEvent(type=RunEventType.REASONING_STARTED)
    for step in (
        "The user wants a comparison of sorting algorithms",
        "Check the Python version before suggesting a benchmark",
    ):
        yield RunEvent(type=RunEventType.REASONING_STEP, step=step)
        await asyncio.sleep(1.0)
    yield RunEvent(type=RunEventType.REASONING_COMPLETED)
    args = {"command": "python3 --version"}
    yield RunEvent(type=RunEventType.TOOL_CALL_STARTED, name="execute_command", args=args, tool_call_id="tc_py")
    await asyncio.sleep(0.3)
    yield RunEvent(
        type=RunEventType.TOOL_CALL_COMPLETED,
        name="execute_command",
        args=args,
        tool_call_id="tc_py",
        result="Python 3.12.4",
    )
    final = SORTING_INTRO + SORTING_TABLE + SORTING_CODE
    for i in range(0, len(final), 32):
        yield RunEvent(type=RunEventType.RUN_CONTENT, token=final[i : i + 32], agent_name=agent)
        await asyncio.sleep(0.01)
    aiui.suggest(SORTING_SUGGESTIONS)
    yield RunEvent(
        type=RunEventType.RUN_PAUSED,
        extra_data={
            "type": "approval_required",
            "id": "ap_numpy",
            "tool_name": "execute_command",
            "arguments": {"command": "pip install numpy"},
            "risk_level": "medium",
            "description": "To benchmark on 1M items, numpy is needed. It installs one package into this Python.",
            "agent_name": agent,
            "tool_call_id": "tc_pip",
        },
    )
    yield RunEvent(type=RunEventType.RUN_COMPLETED, content=final)


async def seed_design_sessions() -> None:
    """Store the design's other chats (title, a question and an answer each)."""
    store = srv.get_datastore()
    for title, question, answer in DESIGN_SESSIONS:
        session = await store.create_session()
        sid = session["id"]
        await store.add_message(sid, {"role": "user", "content": question})
        await store.add_message(sid, {"role": "assistant", "content": answer})
        await store.update_session(sid, title=title)


async def callback_failure(text: str, session_id):
    """A ``@reply`` app whose callback fails, through the real callback mode."""
    from praisonaiui.providers import PraisonAIProvider

    async def failing_reply(msg):
        await msg.stream("partial answer ")
        raise RuntimeError("cbfail: the reply raised")

    async for event in PraisonAIProvider()._run_callback_mode(
        text, failing_reply, session_id, "Mock"
    ):
        yield event


async def callback_ask(text: str, session_id):
    """A ``@reply`` app that asks the user, through the real callback mode."""
    from praisonaiui.callbacks import _set_context
    from praisonaiui.providers import PraisonAIProvider

    async def asking_reply(msg):
        _set_context(msg)  # what @aiui.reply does, so aiui.ask finds the run
        answer = await aiui.ask("Pick one", options=["A", "B"], timeout=30)
        await aiui.say(f"You picked {answer}")

    async for event in PraisonAIProvider()._run_callback_mode(
        text, asking_reply, session_id, "Mock"
    ):
        yield event


async def callback_messages(text: str, session_id):
    """A ``@reply`` app that sends several messages, through the real callback mode."""
    from praisonaiui.callbacks import _set_context
    from praisonaiui.providers import PraisonAIProvider

    async def several(msg):
        _set_context(msg)
        await aiui.notify("Saved to your notes", type="success")
        await aiui.Message(content="First message").send()
        helper = aiui.Message(content="Second message", author="Helper")
        helper.add_image(url=CHART_IMAGE, name="chart")
        await helper.send()
        streamed = aiui.Message(content="")
        for tok in ("Streamed ", "reply"):
            await streamed.stream_token(tok)
        await streamed.send()

    async for event in PraisonAIProvider()._run_callback_mode(
        text, several, session_id, "Mock"
    ):
        yield event


class MockProvider(BaseProvider):
    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        text = str(message)
        if "cbmulti" in text:
            async for event in callback_messages(text, session_id):
                yield event
            return
        if "cbfail" in text:
            async for event in callback_failure(text, session_id):
                yield event
            return
        if "cbask" in text:
            async for event in callback_ask(text, session_id):
                yield event
            return
        if _is_sorting_demo(text):
            async for event in sorting_demo():
                yield event
            return
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

        if "codeel" in text:
            # A code element (not markdown): rendered by the chat Markdown renderer.
            yield RunEvent(
                type=RunEventType.MESSAGE_ELEMENT,
                extra_data={
                    "element": {
                        "type": "code",
                        "language": "python",
                        "content": "def add(a, b):\n    return a + b",
                    }
                },
            )

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
    """Answer the scripted approval ids; everything else reaches the app.

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
            if path.startswith(("/api/approvals/ap_ok/", "/api/approvals/ap_numpy/")):
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
    if os.environ.get("AIUI_E2E_SEED") == "design":
        asyncio.run(seed_design_sessions())
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
