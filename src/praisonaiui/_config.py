"""Convenience configuration for PraisonAIUI.

Provides a single :func:`configure` function to set up the server from
Python code instead of calling a dozen individual ``set_*`` setters.

Example::

    import praisonaiui as aiui

    # Grouped form (preferred — one call, clear structure)
    aiui.configure(
        branding={"title": "My App", "logo": "\U0001f3a8"},
        theme={"preset": "ocean", "dark": True, "radius": "md"},
        chat={"feedback": True, "mode": "single"},
        datastore="json",
        custom_css="styles.css",
        custom_js="plugin.js",
    )

    # Or just the datastore if that's all you need
    aiui.configure(datastore="json")
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Optional, Union


def configure(
    *,
    datastore: Optional[str] = None,
    branding: Optional[Mapping[str, Any]] = None,
    theme: Optional[Mapping[str, Any]] = None,
    chat: Optional[Mapping[str, Any]] = None,
    custom_css: Optional[Union[str, Path]] = None,
    custom_js: Optional[Union[str, Path]] = None,
    style: Optional[str] = None,
) -> None:
    """Configure PraisonAIUI server settings from Python code.

    Call this before the server starts (typically at module level in
    your ``app.py``). Every keyword is optional, so you only set what
    you need.

    Args:
        datastore: Storage backend. One of ``"memory"``, ``"json"``,
            ``"json:/custom/path"``, ``"sdk"``, ``"sdk:/path"``.
        branding: Mapping of branding fields forwarded to
            :func:`praisonaiui.set_branding`. Common keys: ``title``,
            ``logo``, ``subtitle``.
        theme: Mapping forwarded to :func:`praisonaiui.set_theme`. Keys:
            ``preset``, ``dark``/``dark_mode``, ``radius``, ``brand_color``.
        chat: Mapping for chat-mode settings. Keys: ``feedback`` (bool),
            ``mode``, plus anything accepted by
            :func:`praisonaiui.set_chat_features`.
        custom_css: Path to a CSS file injected via
            :func:`praisonaiui.set_custom_css`.
        custom_js: Path to a JS file injected via
            :func:`praisonaiui.set_custom_js`.
        style: Top-level UI style (``"chat"``, ``"dashboard"``, ...).
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

    # Grouped setters. Each block maps straight to the existing set_*
    # functions — no behavioural change, just a single entry point.
    if style is not None:
        from praisonaiui.server import set_style

        set_style(style)

    if branding:
        from praisonaiui.server import set_branding

        set_branding(**dict(branding))

    if theme:
        from praisonaiui.server import set_theme

        # Accept both ``dark`` and ``dark_mode`` for readability.
        kwargs = dict(theme)
        if "dark" in kwargs and "dark_mode" not in kwargs:
            kwargs["dark_mode"] = kwargs.pop("dark")
        # ``brand_color`` gets its own dedicated setter.
        brand_color = kwargs.pop("brand_color", None)
        if kwargs:
            set_theme(**kwargs)
        if brand_color:
            from praisonaiui.server import set_brand_color

            set_brand_color(brand_color)

    if chat:
        kwargs = dict(chat)
        feedback = kwargs.pop("feedback", None)
        mode = kwargs.pop("mode", None)
        if feedback is not None:
            from praisonaiui.server import set_feedback_enabled

            set_feedback_enabled(bool(feedback))
        if mode is not None:
            from praisonaiui.server import set_chat_mode

            set_chat_mode(mode)
        if kwargs:
            from praisonaiui.server import set_chat_features

            set_chat_features(**kwargs)

    if custom_css is not None:
        from praisonaiui.server import set_custom_css

        set_custom_css(custom_css)

    if custom_js is not None:
        from praisonaiui.server import set_custom_js

        set_custom_js(custom_js)
