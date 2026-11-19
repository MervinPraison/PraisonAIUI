"""Open a browser tab only when a person is there to see it.

``aiui serve``, ``aiui dev`` and the examples dashboard used to open a browser on
every start. Scripts, CI jobs and coding agents start these servers too, and each
start popped a new window on the user's screen. The rule now:

* ``--no-open`` or ``AIUI_NO_BROWSER=1``: never open.
* ``--open``: open.
* Neither (the default): open only when stdout is a terminal and no CI or test
  runner is detected.
"""

from __future__ import annotations

import os
import sys
import threading
from typing import Optional

_CI_VARS = ("CI", "GITHUB_ACTIONS", "BUILDKITE", "GITLAB_CI", "PYTEST_CURRENT_TEST")


def _truthy(value: Optional[str]) -> bool:
    return (value or "").strip().lower() not in ("", "0", "false", "no", "off")


def should_open(requested: Optional[bool] = None) -> bool:
    """Whether to open a browser; ``requested`` is the ``--open/--no-open`` flag (None: not given)."""
    if _truthy(os.environ.get("AIUI_NO_BROWSER")) or requested is False:
        return False
    if requested is True:
        return True
    if any(_truthy(os.environ.get(name)) for name in _CI_VARS):
        return False
    try:
        return sys.stdout.isatty()
    except (AttributeError, ValueError):
        return False


def open_url(url: str, requested: Optional[bool] = None, delay: float = 0.0) -> bool:
    """Open ``url`` in the default browser when :func:`should_open` allows it; returns whether it did."""
    if not should_open(requested):
        return False
    import webbrowser

    if delay > 0:
        threading.Timer(delay, webbrowser.open, args=(url,)).start()
    else:
        webbrowser.open(url)
    return True
