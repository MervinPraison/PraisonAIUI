"""Convenience configuration for PraisonAIUI.

Provides a single `configure()` function to set up the server
from Python code instead of CLI flags.

Example::

    import praisonaiui as aiui

    aiui.configure(datastore="json")          # JSON persistence (default path)
    aiui.configure(datastore="json:/tmp/db")  # JSON persistence (custom path)
    aiui.configure(datastore="memory")        # In-memory (default)
"""

from __future__ import annotations

from typing import Optional


def configure(
    *,
    datastore: Optional[str] = None,
) -> None:
    """Configure PraisonAIUI server settings from Python code.

    Call this before the server starts (typically at module level in your app.py).

    Args:
        datastore: Storage backend. One of:
            - ``"memory"`` — in-memory (default, volatile)
            - ``"json"``   — JSON files at ``~/.praisonaiui/sessions/``
            - ``"json:/custom/path"`` — JSON files at a custom directory
            - ``"sdk"``   — SDK-backed store at ``~/.praisonai/sessions/``
              (unifies with praisonai-agents session persistence)
    """
    if datastore is not None:
        from praisonaiui.datastore import JSONFileDataStore, MemoryDataStore
        from praisonaiui.server import set_datastore

        if datastore == "memory":
            set_datastore(MemoryDataStore())
        elif datastore == "json":
            set_datastore(JSONFileDataStore())
        elif datastore.startswith("json:"):
            set_datastore(JSONFileDataStore(data_dir=datastore[5:]))
        elif datastore == "sdk":
            from praisonaiui.datastore_sdk import SDKFileDataStore
            set_datastore(SDKFileDataStore())
        elif datastore.startswith("sdk:"):
            from praisonaiui.datastore_sdk import SDKFileDataStore
            set_datastore(SDKFileDataStore(session_dir=datastore[4:]))
        else:
            raise ValueError(
                f"Unknown datastore: {datastore!r}. "
                f"Use 'memory', 'json', 'json:/path', 'sdk', or 'sdk:/path'."
            )
