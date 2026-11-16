# Bootstrap

`aiui run app.py` is the one entry point for an app. It imports `app.py` (under
the module name `user_app`, so an `if __name__ == "__main__":` block does not
run), reads what the module registered, and starts its own server on `--host`
and `--port`.

## Supported Patterns

### 1. Chat Applications

```python
import praisonaiui as aiui

@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

**Run**: `aiui run app.py` (opens the `app` shell, the `aiui run` default; use
`aiui run app.py --style chat` for the classic chat UI)

### 2. Dashboard Applications

```python
import praisonaiui as aiui

@aiui.page("reports", title="Reports", icon="📊")
async def reports_page():
    return {"title": "Reports", "content": "Monthly numbers"}
```

**Run**: `aiui run app.py` (an `@aiui.page` callback selects the `dashboard`
style; see [UI Styles](../features/styles.md)). A module that builds its own app
with `create_app()` and starts Uvicorn under `if __name__ == "__main__":` is not
special-cased: `aiui run` ignores that app and serves its own. Run such a file
with `python app.py` instead.

### 3. Gateway Applications

```python
import asyncio
import os

from praisonaiagents import Agent
from praisonaiui.integration import AIUIGateway

agent = Agent(name="assistant", instructions="You are helpful.")

async def main():
    gateway = AIUIGateway(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8083")),
    )
    gateway.register_agent(agent)
    await gateway.start()

if __name__ == "__main__":
    asyncio.run(main())
```

**Run**: `aiui run app.py`. An async `main()` together with an import of
`AIUIGateway` from `praisonaiui.integration` switches to the `praisonai`
backend. When the module defines `main()`, the CLI sets the `PORT` and `HOST`
environment variables from `--port`/`--host` (unless they are already set) and
calls your `main()`, so `main()` must read them to honour the CLI options, as
above. Without a `main()`, the CLI builds its own `AIUIGateway` on
`--host`/`--port` and registers the module's `agent` (or each item of
`agents`). The backend needs the `praisonai` package
(`pip install "aiui[praisonai]"`).

## Bootstrap Detection

| `app.py` contains | Backend | Style |
|-------------------|---------|-------|
| async `main()` and `from praisonaiui.integration import AIUIGateway` | `praisonai` | as below |
| anything else | `standalone` | detected from the callbacks |

Detection runs whenever `--backend` is `standalone`, which is also the
default, so passing `--backend standalone` does not turn it off. The style rules
are in [UI Styles](../features/styles.md#auto-detection).

## Explicit Backend

```bash
aiui run app.py --backend praisonai   # WebSocketGateway backend
aiui run app.py --backend standalone  # the default (gateway detection still runs)
```

`--reload` restarts the server when a file in the folder of `app.py` changes.
