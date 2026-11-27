"""Tests for unified UI blocks in chat, duck-typed DataFrame support, and Plotly conversion."""

from __future__ import annotations

import asyncio
import math
import subprocess
import sys
from typing import Any

import pytest

import praisonaiui as aiui
from praisonaiui.provider import RunEventType
from praisonaiui.providers import PraisonAIProvider
from praisonaiui.server import _callbacks


class _FakePandasDF:
    """Minimal duck-typed pandas DataFrame (no pandas dependency needed in tests)."""

    def __init__(self, cols: list[str], records: list[dict[str, Any]]) -> None:
        self.columns = cols
        self._records = records

    def to_dict(self, orient: str = "dict") -> Any:
        if orient == "records":
            return self._records
        raise AssertionError(f"Unexpected orient={orient!r}")


class _FakePolarsDF:
    """Minimal duck-typed Polars DataFrame."""

    def __init__(self, cols: list[str], records: list[dict[str, Any]]) -> None:
        self.columns = cols
        self._records = records

    def to_dicts(self) -> list[dict[str, Any]]:
        return self._records


class _FakeNumpyScalar:
    def __init__(self, value: Any) -> None:
        self._value = value

    def item(self) -> Any:
        return self._value


class _FakePlotlyFigure:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def to_dict(self) -> dict[str, Any]:
        return self._payload


class TestDataFrameCoercion:
    def test_table_accepts_positional_pandas_like_df(self):
        df = _FakePandasDF(
            ["agent", "latency", "score"],
            [
                {"agent": "Researcher", "latency": _FakeNumpyScalar(42), "score": float("nan")},
                {"agent": "Writer", "latency": _FakeNumpyScalar(18), "score": 0.95},
            ],
        )
        comp = aiui.table(df, searchable=True)
        assert comp["type"] == "table"
        assert comp["headers"] == ["agent", "latency", "score"]
        assert comp["rows"] == [["Researcher", 42, None], ["Writer", 18, 0.95]]
        assert comp["searchable"] is True

    def test_table_accepts_polars_like_df_via_rows_kwarg(self):
        df = _FakePolarsDF(
            ["day", "requests"],
            [{"day": "Mon", "requests": 100}, {"day": "Tue", "requests": 140}],
        )
        comp = aiui.table(rows=df)
        assert comp["headers"] == ["day", "requests"]
        assert comp["rows"] == [["Mon", 100], ["Tue", 140]]

    def test_table_accepts_list_of_dicts_positionally(self):
        comp = aiui.table([{"name": "A", "count": 1}, {"name": "B", "count": 2}])
        assert comp["headers"] == ["name", "count"]
        assert comp["rows"] == [["A", 1], ["B", 2]]

    def test_table_preserves_backward_compatible_signature(self):
        comp = aiui.table(headers=["A", "B"], rows=[[1, 2]])
        assert comp == {"type": "table", "headers": ["A", "B"], "rows": [[1, 2]]}

    def test_chart_accepts_dataframe(self):
        df = _FakePandasDF(
            ["month", "revenue"],
            [
                {"month": "Jan", "revenue": _FakeNumpyScalar(1000)},
                {"month": "Feb", "revenue": _FakeNumpyScalar(1500)},
            ],
        )
        comp = aiui.chart("Revenue", data=df, chart_type="line", x="month", y="revenue")
        assert comp["type"] == "chart"
        assert comp["chart_type"] == "line"
        assert comp["data"] == [
            {"month": "Jan", "revenue": 1000},
            {"month": "Feb", "revenue": 1500},
        ]


class TestPlotlyChartConversion:
    def test_bar_and_stacked_bar(self):
        fig = _FakePlotlyFigure(
            {
                "data": [
                    {"type": "bar", "name": "Desktop", "x": ["Q1", "Q2"], "y": [10, 20]},
                    {"type": "bar", "name": "Mobile", "x": ["Q1", "Q2"], "y": [5, 15]},
                ],
                "layout": {"title": {"text": "Traffic"}, "barmode": "stack"},
            }
        )
        comp = aiui.plotly_chart(fig)
        assert comp["type"] == "chart"
        assert comp["title"] == "Traffic"
        assert comp["chart_type"] == "bar"
        assert comp["stacked"] is True
        assert comp["y"] == ["Desktop", "Mobile"]
        assert comp["data"] == [
            {"category": "Q1", "Desktop": 10, "Mobile": 5},
            {"category": "Q2", "Desktop": 20, "Mobile": 15},
        ]

    def test_horizontal_bar(self):
        comp = aiui.plotly_chart(
            {
                "data": [{"type": "bar", "orientation": "h", "x": [30, 50], "y": ["A", "B"]}],
                "layout": {"title": "Horizontal"},
            }
        )
        assert comp["chart_type"] == "barh"
        assert comp["data"] == [{"category": "A", "series_1": 30}, {"category": "B", "series_1": 50}]

    def test_line_area_and_scatter(self):
        line = aiui.plotly_chart(
            {"data": [{"type": "scatter", "mode": "lines", "x": ["Mon", "Tue"], "y": [1, 3]}]}
        )
        assert line["chart_type"] == "line"

        area = aiui.plotly_chart(
            {
                "data": [
                    {
                        "type": "scatter",
                        "mode": "lines",
                        "fill": "tozeroy",
                        "x": ["Mon", "Tue"],
                        "y": [1, 3],
                    }
                ]
            }
        )
        assert area["chart_type"] == "area"

        scatter = aiui.plotly_chart(
            {
                "data": [
                    {
                        "type": "scatter",
                        "mode": "markers",
                        "x": [1, 2],
                        "y": [4, 5],
                        "text": ["p1", "p2"],
                    }
                ]
            }
        )
        assert scatter["chart_type"] == "scatter"
        assert scatter["label"] == "label"
        assert scatter["data"] == [{"x": 1, "y": 4, "label": "p1"}, {"x": 2, "y": 5, "label": "p2"}]

    def test_pie_donut_histogram_heatmap(self):
        donut = aiui.plotly_chart(
            {"data": [{"type": "pie", "labels": ["A", "B"], "values": [60, 40], "hole": 0.4}]}
        )
        assert donut["chart_type"] == "donut"

        hist = aiui.plotly_chart({"data": [{"type": "histogram", "x": [1, 2, 2, 3, math.nan]}]})
        assert hist["chart_type"] == "histogram"
        assert hist["data"][-1] == {"value": None}

        heat = aiui.plotly_chart(
            {"data": [{"type": "heatmap", "x": ["c1", "c2"], "y": ["r1"], "z": [[1, 2]]}]}
        )
        assert heat["chart_type"] == "heatmap"
        assert heat["data"] == [
            {"x": "c1", "y": "r1", "value": 1},
            {"x": "c2", "y": "r1", "value": 2},
        ]

    def test_unsupported_trace_degrades_gracefully(self):
        comp = aiui.plotly_chart(
            {"data": [{"type": "scatter3d", "x": [1], "y": [2], "z": [3]}], "layout": {"title": "3D"}}
        )
        assert comp["type"] == "container"
        assert comp["children"][0]["type"] == "alert"
        assert comp["children"][1]["type"] == "json_view"


class TestSendBlockInChat:
    @pytest.mark.asyncio
    async def test_send_block_outside_context_returns_false(self):
        ok = await aiui.send_block(aiui.metric("Users", value=42))
        assert ok is False

    @pytest.mark.asyncio
    async def test_send_block_streams_message_element_through_callback_provider(self):
        prev = _callbacks.get("reply")
        try:

            @aiui.reply
            async def _handler(msg: str):
                await aiui.say(f"Answer to {msg}")
                await aiui.send_block(aiui.metric("Active", value=7, delta="+2"))
                await aiui.send_block(
                    _FakePandasDF(["col"], [{"col": "val"}]),
                    name="Summary",
                )
                await aiui.send_block(
                    aiui.layout([aiui.badge("Live"), aiui.alert("Ready", variant="success")])
                )

            provider = PraisonAIProvider()
            events = [ev async for ev in provider.run("hi", session_id="s-blocks")]
            elem_events = [e for e in events if e.type == RunEventType.MESSAGE_ELEMENT]
            assert len(elem_events) == 3

            first = elem_events[0].extra_data["element"]
            assert first["type"] == "block"
            assert first["id"].startswith("blk_")
            assert first["block"] == {"type": "metric", "label": "Active", "value": 7, "delta": "+2"}

            second = elem_events[1].extra_data["element"]
            assert second["type"] == "block"
            assert second["name"] == "Summary"
            assert second["block"]["type"] == "table"
            assert second["block"]["headers"] == ["col"]

            third = elem_events[2].extra_data["element"]
            assert third["block"]["type"] == "container"
            assert len(third["block"]["children"]) == 2
        finally:
            if prev is None:
                _callbacks.pop("reply", None)
            else:
                _callbacks["reply"] = prev

    @pytest.mark.asyncio
    async def test_send_block_rejects_invalid_payload(self):
        from praisonaiui.callbacks import _set_context
        from praisonaiui.server import MessageContext

        ctx = MessageContext(text="hi", session_id="s-err")
        ctx._stream_queue = asyncio.Queue()
        _set_context(ctx)
        try:
            with pytest.raises(ValueError, match="send_block"):
                await aiui.send_block("not a block")
        finally:
            _set_context(None)

    def test_lazy_imports_never_load_pandas_or_plotly(self):
        code = (
            "import sys, praisonaiui as aiui\n"
            "aiui.table(headers=['a'], rows=[[1]])\n"
            "aiui.plotly_chart({'data': [{'type': 'bar', 'x': ['a'], 'y': [1]}]})\n"
            "assert 'pandas' not in sys.modules\n"
            "assert 'plotly' not in sys.modules\n"
        )
        res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
        assert res.returncode == 0, res.stderr

    def test_plotly_barh_handles_missing_axes_without_crashing(self):
        block = aiui.plotly_chart({"data": [{"type": "bar", "orientation": "h", "x": [5, 10]}]})
        assert block["type"] == "chart"
        assert block["chart_type"] == "barh"
        assert len(block["data"]) == 2
