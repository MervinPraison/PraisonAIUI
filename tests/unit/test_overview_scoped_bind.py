"""Regression tests for issue #207.

The Agent Command Center overview polled pending approvals every 10s and
re-rendered only ``#ov-metrics`` and ``#ov-attention`` but then called
``bindEvents(_container, data)`` over the whole overview root. Interactive
elements in the page shell that were not re-rendered (agent rows, omnibar)
accumulated stacked click/keydown listeners.

These tests assert the committed frontend view source
``src/praisonaiui/templates/frontend/plugins/views/overview.js`` scopes the
re-bind to only the subtrees that were re-rendered, so stale shell nodes no
longer stack listeners.
"""

from __future__ import annotations

import re
from pathlib import Path

OVERVIEW_VIEW = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "views"
    / "overview.js"
)


def _view() -> str:
    return OVERVIEW_VIEW.read_text()


def _refresh_approvals_body() -> str:
    src = _view()
    start = src.index("async function refreshApprovals()")
    end = src.index("function startPolling()", start)
    return src[start:end]


class TestScopedBind:
    def test_metrics_subtree_rebound(self):
        assert "bindEvents(metricsEl, data)" in _refresh_approvals_body()

    def test_attention_subtree_rebound(self):
        assert "bindEvents(attnEl, data)" in _refresh_approvals_body()

    def test_no_full_container_rebind_in_refresh(self):
        assert "bindEvents(_container, data)" not in _refresh_approvals_body()

    def test_paint_still_binds_full_container(self):
        src = _view()
        start = src.index("async function paint()")
        end = src.index("async function refreshApprovals()", start)
        assert "bindEvents(_container, data)" in src[start:end]

    def test_full_container_bind_only_in_paint(self):
        # Exactly one full-tree bind remains (paint's initial render).
        assert len(re.findall(r"bindEvents\(_container, data\)", _view())) == 1
