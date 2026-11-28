# Steps

> A step is a named piece of work inside a reply: a tool call, an LLM call, a

A step is a named piece of work inside a reply: a tool call, an LLM call, a
retrieval, a sub-run. The chat shows the reply's steps as a collapsible tree
with each step's name, status (running, done, failed, stopped) and duration;
opening a step shows its input, output and child steps. Steps are saved with
the reply, so a reload shows the same tree with the same durations.

```python
import praisonaiui as aiui

@aiui.step(type="tool")
def web_search(query: str):
    return f"3 results for {query}"

@aiui.reply
async def answer(message):
    async with aiui.Step("Plan", type="run") as plan:
        await plan.stream_token("Looking it up")   # streamed into the step's output
        results = web_search(message.text)          # the step "web_search", nested under "Plan"
    await aiui.say(f"Found: {results}")
```

**`@aiui.step`** works bare, with `()` or with arguments
(`@aiui.step("Search the web", type="tool")`), on sync and async functions. The
step is named after the function unless named; its input is the call's
arguments (`self`/`cls` left out), its output the return value, and an
exception marks it failed (and is raised as usual).

**`aiui.Step`** is used as `async with` or `with` (sync code and worker threads
too); in sync code `step.stream_token(t)` sends without `await`.

**Nesting** is automatic: a step opened while another runs becomes its child,
across `await`s, in tasks started from it (`asyncio.gather`, `create_task`) and
in `aiui.make_async` threads. `parent=` sets the parent explicitly.

## Reference

`aiui.Step(name, type="reasoning", parent=None, metadata={}, input=None, output=None)`

| Field | Meaning |
|---|---|
| `type` | `run`, `tool`, `llm`, `embedding`, `retrieval`, `rerank`, `undefined`, `tool_call`, `reasoning`, `sub_agent`, `custom` |
| `input`, `output` | Shown when the step is opened; data as JSON, text as is, each at most 1 MB |
| `metadata` | Extra data sent with the step's start and end |
| `id`, `start`, `end`, `duration`, `status`, `error` | Read-only: epoch ms, seconds, `running`/`done`/`error`/`stopped`, the exception text |

`@aiui.step(name=None, type="reasoning", **metadata)` wraps each call in a `Step`.

**Events** (WebSocket and `/run` SSE, protocol 1.2), each with `step_id`:
`step_start` (`name`, `step_type`, `parent_id`, `start` in epoch ms, `input`),
`step_update` (`token` to append) and `step_end` (`end`, `status`, `duration`
in seconds, `error`, and `input`/`output` when changed). The saved reply keeps
`steps: [{step_id, parent_id, name, step_type, status, start, end, input,
output, error}]`. A step outside a reply sends nothing but still times itself.
`await aiui.think("...")` still shows unnamed reasoning text.

## Related pages

- [Handler context](https://ui.praison.ai/docs/features/handler-context.md)
- [Messages, Streaming & Interactions](https://ui.praison.ai/docs/chat-ui/messages-and-streaming.md)
- [Docs UI Overview](https://ui.praison.ai/docs/docs-ui/overview.md)
