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

**Run**: `aiui run app.py` (style `chat`)

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

from praisonaiagents import Agent
from praisonaiui.integration import AIUIGateway

agent = Agent(name="assistant", instructions="You are helpful.")

async def main():
    gateway = AIUIGateway(port=8083)
    gateway.register_agent(agent)
    await gateway.start()

if __name__ == "__main__":
    asyncio.run(main())
```

**Run**: `aiui run app.py`. An async `main()` together with an import of
`AIUIGateway` from `praisonaiui.integration` switches to the `praisonai`
backend. The CLI then builds its own `AIUIGateway` on `--host`/`--port` and
registers the module's `agent` (or each item of `agents`); your `main()` is not
called. `python app.py` runs `main()` as written. The backend needs the
`praisonai` package (`pip install "aiui[praisonai]"`).

## Bootstrap Detection

| `app.py` contains | Backend | Style |
|-------------------|---------|-------|
| async `main()` and `from praisonaiui.integration import AIUIGateway` | `praisonai` | as below |
| anything else | `standalone` | detected from the callbacks |

Detection runs only when `--backend` is left at its default. The style rules
are in [UI Styles](../features/styles.md#auto-detection).

## Explicit Backend

```bash
aiui run app.py --backend praisonai   # WebSocketGateway backend
aiui run app.py --backend standalone  # the default
```

`--reload` restarts the server when a file in the folder of `app.py` changes.
