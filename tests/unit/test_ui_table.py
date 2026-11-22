"""ui.table(): the old dict stays byte-for-byte; columns, dict rows and row links are additive."""

import json

import pytest

from praisonaiui.ui import table

NUM = {"key": "views", "label": "Views", "type": "number", "format": "compact"}


def test_old_call_keeps_the_exact_dict():
    t = table(headers=["A", "B"], rows=[[1, 2], ("x", None)], row_ids=["a", "b"], actions=["E"])
    assert t == {"type": "table", "headers": ["A", "B"], "rows": [[1, 2], ["x", None]],
                 "row_ids": ["a", "b"], "actions": ["E"]}  # fmt: skip
    assert set(table(headers=["A"], rows=[]).keys()) == {"type", "headers", "rows"}


def test_columns_give_headers_and_dict_rows_become_arrays():
    t = table(columns=["Name", NUM], rows=[["a", 1200], {"views": 5, "Name": "x", "extra": 1}])
    assert t["headers"] == ["Name", "Views"]
    assert t["columns"] == [{"key": "Name", "label": "Name"}, NUM]
    # Rows stay arrays, so the legacy dashboard renderer still draws them.
    assert t["rows"] == [["a", 1200], ["x", 5]]


def test_href_key_link_cells_and_row_links():
    link = {"key": "name", "type": "link", "href_key": "url"}
    rows = [{"name": "Chan", "url": "https://example.com/c"}, {"name": "No link", "url": ""}]
    t = table(columns=[link], rows=rows, row_href_key="url")
    assert t["rows"] == [[{"text": "Chan", "href": "https://example.com/c"}], ["No link"]]
    assert "href_key" not in t["columns"][0]
    assert t["row_hrefs"] == ["https://example.com/c", None]
    # With array rows, row_href_key names a column.
    assert table(headers=["N", "L"], rows=[["a", "/a"]], row_href_key="L")["row_hrefs"] == ["/a"]


def test_options_only_appear_when_set():
    opts = {
        "searchable": True,
        "page_size": 0,
        "sortable": False,
        "max_height": 400,
        "caption": "X",
    }
    t = table(headers=["A"], rows=[[1]], **opts)
    assert {k: t[k] for k in opts} == opts


def test_1100_rows_serialise():
    rows = [{"name": f"c{i}", "views": i * 1000, "url": f"/c/{i}"} for i in range(1100)]
    t = table(columns=[{"key": "name"}, NUM], rows=rows, searchable=True, row_href_key="url")
    assert len(t["rows"]) == len(t["row_hrefs"]) == 1100
    json.dumps(t)


@pytest.mark.parametrize(
    "kwargs, error",
    [
        ({"rows": []}, ValueError),
        ({"columns": [{"type": "number"}], "rows": []}, ValueError),
        ({"columns": [{"key": "a", "type": "sparkline"}], "rows": []}, ValueError),
        ({"columns": [1], "rows": []}, TypeError),
        ({"headers": ["A", "B"], "columns": ["A"], "rows": []}, ValueError),
        ({"headers": ["A"], "rows": [], "page_size": -1}, ValueError),
    ],
)
def test_bad_config_raises(kwargs, error):
    with pytest.raises(error):
        table(**kwargs)


def test_row_detail_and_detail_key():
    panel = [{"type": "text", "content": "hi"}]
    rows = [
        {"name": "a", "more": panel},
        {"name": "b", "more": None},
        {"name": "c", "more": ("x",)},
    ]
    t = table(columns=["name"], rows=rows, detail_key="more")
    assert t["row_details"] == [panel, [], ["x"]]
    assert t["row_detail"] is True
    flag = table(headers=["A"], rows=[[1]], row_detail=True)
    assert flag["row_detail"] is True and "row_details" not in flag
    assert "row_detail" not in table(headers=["A"], rows=[[1]])


def test_date_column_type():
    t = table(
        columns=[{"key": "last", "type": "date", "format": "iso"}], rows=[{"last": "2026-11-22"}]
    )
    assert t["columns"][0]["type"] == "date" and t["rows"] == [["2026-11-22"]]
    with pytest.raises(ValueError):
        table(columns=[{"key": "x", "type": "datetime"}], rows=[])


def test_sparkline_column_type():
    t = table(columns=[{"key": "trend", "type": "sparkline"}], rows=[{"trend": [1, 3, 2]}])
    assert t["columns"][0]["type"] == "sparkline" and t["rows"] == [[[1, 3, 2]]]
