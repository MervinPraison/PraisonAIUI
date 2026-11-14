# Bootstrap Architecture

PraisonAIUI provides a unified bootstrap entrypoint through `aiui run app.py` that automatically detects and handles different application patterns.

## Supported Patterns

### 1. Chat Applications
```python
import praisonaiui as aiui

@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

**Run**: `aiui run app.py`

### 2. Dashboard Applications  
```python
from praisonaiui.server import create_app
import uvicorn

if __name__ == "__main__":
    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=8082)
```

**Run**: `aiui run app.py` (automatically detects `create_app()` pattern)

### 3. Gateway Applications
```python
import asyncio
from praisonaiui.integration import AIUIGateway

async def main():
    gateway = AIUIGateway(host="0.0.0.0", port=8083)
    # ... register agents
    await gateway.start()

if __name__ == "__main__":
    asyncio.run(main())
```

**Run**: `aiui run app.py` (auto-detects gateway pattern and switches to `praisonai` backend)

## Bootstrap Detection

The CLI automatically detects application types:

- **Gateway Pattern**: Async `main()` function + AIUIGateway imports → Uses `praisonai` backend
- **Dashboard Pattern**: `create_app()` usage → Uses `standalone` backend  
- **Chat Pattern**: `@reply` decorators → Uses `standalone` backend

## Migration Guide

### From Manual Bootstrap
**Before:**
```bash
python app.py
```

**After:**
```bash
aiui run app.py
```

### Benefits
- Consistent configuration loading
- Unified port/host management  
- Doctor compatibility
- Reload support via `--reload`
- Backend auto-detection

### Escape Hatch
For special cases, explicit backend selection is still supported:
```bash
aiui run app.py --backend praisonai  # Force gateway backend
aiui run app.py --backend standalone # Force standalone backend
```