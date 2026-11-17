# Config Hot-Reload

A running server can reload its runtime config file without a restart. The
server keeps the state of its CRUD features (agents, skills, channels and
others) in one YAML file, `config.yaml` in the data directory
(`AIUI_DATA_DIR`, default `~/.praisonaiui/`). The config watcher polls that
file and, when it changes, reloads it.

The watcher belongs to `builtin.config`: it is created with the server while
that built-in is on, and does not start on its own.

## Quick Start

```bash
# Start the watcher
curl -X POST http://localhost:8000/api/config/watcher/start

# Edit ~/.praisonaiui/config.yaml; the change applies within a few seconds

# Watcher status
curl http://localhost:8000/api/config/watcher
```

## How It Works

1. The watcher reads the file every 3 seconds and compares its MD5 hash with
   the previous one.
2. On a change it reloads the config store, then calls `on_config_reload()`
   on every registered feature. The agents, skills and channels features use
   it to re-read their part of the file; a disabled built-in is not registered,
   so a reload never imports it.

A feature of your own that caches config-store data overrides the hook:

```python
class MyFeature(BaseFeatureProtocol):
    def on_config_reload(self) -> None:
        self._cache = None  # re-read on next access
```

A YAML site config (`aiui.yaml`) or `app.py` is not watched; for those
see [Hot Reload](hot-reload.md).

## Your own watcher

`ConfigWatcher` watches any file and calls your callbacks (sync or async, with
no arguments) when it changes. `start()` must run inside an asyncio event loop,
for example in an `@aiui.on_startup` handler:

```python
from pathlib import Path

import praisonaiui as aiui
from praisonaiui.features.config_hot_reload import ConfigWatcher

watcher = ConfigWatcher(config_path=Path("./settings.yaml"), poll_interval=2.0)

def handle_reload():
    print("settings.yaml changed")

watcher.on_reload(handle_reload)

@aiui.on_startup
async def start_watcher():
    watcher.start()
```

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config/watcher` | GET | Watcher status |
| `/api/config/watcher/start` | POST | Start the watcher |
| `/api/config/watcher/stop` | POST | Stop the watcher |
| `/api/config/reload` | POST | Reload on the next poll, even if the file did not change |

### Watcher Status

```json
{
  "watching": true,
  "config_path": "/home/me/.praisonaiui/config.yaml",
  "poll_interval": 3.0,
  "last_reload": 1709734400.0,
  "reload_count": 3,
  "last_hash": "9e107d9d372bb6826bd81d3542a419d6"
}
```

## Related

- [YAML Configuration](../concepts/configuration.md): config file format, including runtime persistence
- [Protocols](protocols.md): the feature protocol system
