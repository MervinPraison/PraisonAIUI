# Handler context

Inside an `@aiui.reply` handler you can ask who is calling, keep state for
this chat, read the chat's history in the shape an LLM wants, pop a notice,
and call the UI from blocking worker code. Nothing to configure.

```python
import praisonaiui as aiui
from openai import AsyncOpenAI

client = AsyncOpenAI()

@aiui.reply
async def answer(msg):
    session = aiui.context.session              # who, from where, which language
    aiui.user_session["turns"] = aiui.user_session.get("turns", 0) + 1

    reply = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=aiui.chat_context.to_openai(system=f"Answer in {session.language or 'en'}."),
    )
    await aiui.say(reply.choices[0].message.content)
    await aiui.notify("Answer ready", type="success")
```

Each API resolves to the chat being answered (two people chatting at once never
see each other's data), also in tasks the handler starts and `aiui.make_async` threads.

## `aiui.context.session`

| Attribute | Value |
|---|---|
| `id` | The chat (session) id. |
| `user` | The signed-in user as a dict (`id`, `username`, extra fields; never the password hash), or `None`. `aiui.current_user()` returns the same dict. |
| `client_type` | `"webapp"` (a browser), `"api"` (a script or HTTP client), `"copilot"`, or the bot platform (`"slack"`, `"discord"`, `"teams"`, …). |
| `chat_profile` | The profile chosen for this chat, or the server-wide selection. |
| `chat_settings` | Settings sent with the chat (dict). |
| `env` | Per-chat values sent by the client (dict of strings). |
| `language` | The best tag of the caller's `Accept-Language` (`"fr-CA"`), or `None`. |
| `headers` | Request headers, lower-cased, with credentials removed (`Authorization`, `Cookie`, and any header whose name mentions a token, key, secret, password, auth or session). |

It is `None` outside a handler. A client names itself with `?client=<name>` on the chat WebSocket or an
`X-Aiui-Client: <name>` header (letters, digits, `-` and `_`, up to 32
characters). A chat turn (`{type: "chat", ...}` on `/api/chat/ws`, or the body
of `POST /api/chat/send`) may carry `chat_profile`, `chat_settings` and `env`;
they stay with the chat for its later turns.

## `aiui.user_session`

A key/value store private to the current chat, kept across its turns.

```python
aiui.user_session.set("plan", "pro")       # or aiui.user_session["plan"] = "pro"
plan = aiui.user_session.get("plan", "free")
```

Preset keys: `id`, `user`, `chat_profile`, `chat_settings`, `env`. Values live
in memory (the last 5,000 chats), so keep what must survive a restart in your
own database. Outside a handler `get` returns the default and `set` raises.

## `aiui.chat_context`

The chat's messages, oldest first, including the one being answered; each
finished reply is added. After a restart the saved history is reloaded from
the datastore. At most 200 messages are kept.

| Method | Does |
|---|---|
| `get()` | A copy of the messages: `[{"role", "content"}, ...]`. |
| `add(content, role="assistant")` | Append a message (a string with a role, or a `{"role", "content"}` dict). Roles: `system`, `user`, `assistant`, `tool`. |
| `remove(message)` | Remove the latest message equal to `message`; returns `True` if one was removed. |
| `clear()` | Forget the history (for example on a "new topic" command). |
| `to_openai(system=None, max_messages=None)` | OpenAI chat messages, with an optional system prompt first and only the last `max_messages`. Works with any OpenAI-compatible client. |

## Blocking code: `aiui.make_async` and `aiui.run_sync`

Run blocking work in a thread so the chat stays responsive, and call the UI
from inside it:

```python
def slow_tool(query: str) -> str:
    aiui.run_sync(aiui.say(f"Searching for {query}..."))   # reaches this chat
    return search_index(query)

@aiui.reply
async def answer(msg):
    result = await aiui.make_async(slow_tool)(msg.text)
    await aiui.say(result)
```

`make_async(fn, executor=None)` runs `fn` on a thread pool (yours, if given)
with the handler's context. From that thread, `run_sync(coro, timeout=None)`
runs the coroutine on the server's loop and waits; in a plain script it starts
its own loop; in async code it raises `RuntimeError` (use `await`).

## `aiui.notify`

```python
await aiui.notify("Saved to your notes", type="success", duration=2000)
```

`type` is `info`, `success`, `warning` or `error`; `duration` is in
milliseconds. The notice is never saved with the reply or added to
`aiui.chat_context`. Clients receive `{type: "toast", session_id, run_id,
message, variant, duration?}` on the chat WebSocket; the built-in chat views
do not show it yet. Returns `False` outside a handler. (`aiui.toast(...)`
builds a toast component for a page.)
