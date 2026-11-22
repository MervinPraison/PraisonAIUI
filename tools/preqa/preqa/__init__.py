"""Pre-QA environment and performance tracker for the PraisonAIUI docs site.

Internal tooling: not part of the published package. Each module works alone:

- ``stats``    percentiles and metric summaries (stdlib)
- ``budgets``  compare a run's metrics with ``budgets.json`` (stdlib)
- ``history``  append and read the JSON-lines run history (stdlib)
- ``report``   turn the history into ``report.json`` for the dashboard (stdlib)
- ``notify``   one message per new failure, Slack only when configured (stdlib)
- ``serve``    GitHub-Pages-like static server for a built site + /preqa/ (stdlib)
- ``site``     build a site from a git ref with ``aiui build`` (stdlib + git, uv)
- ``track``    the synthetic checks (Playwright, headless Chromium)
"""

__version__ = "1"
