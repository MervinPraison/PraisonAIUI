"""Cross-platform console output for examples.

Legacy Windows consoles default stdout to a non-UTF code page (cp1252/cp437)
that cannot encode emoji such as U+1F680. Calling ``print`` with those
characters raises ``UnicodeEncodeError`` and crashes the example before the
server starts. These helpers mirror the ``_supports_unicode``/``_icon`` pattern
in ``praisonaiui.cli`` so examples degrade to ASCII instead of crashing while
preserving emoji on UTF-aware terminals.

Usage:
    from _shared.console import safe_print, icon

    safe_print(f"{icon('🚀', '[START]')} Starting gateway...")
"""

from __future__ import annotations

import sys
from typing import Any


def supports_unicode() -> bool:
    try:
        encoding = sys.stdout.encoding or ""
    except Exception:
        return False
    return "utf" in encoding.lower()


def icon(symbol: str, fallback: str) -> str:
    return symbol if supports_unicode() else fallback


def safe_print(*args: Any, **kwargs: Any) -> None:
    sep = kwargs.pop("sep", " ")
    text = sep.join(str(a) for a in args)
    try:
        print(text, **kwargs)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"), **kwargs)
