"""ui.table(): the old dict shape stays byte-for-byte; columns, dict rows, row links and details are additive."""

import json

import pytest

from praisonaiui.ui import table


def test_old_call_keeps_the_exact_dict():
    t = table(headers=["A", "B"], rows=[[1, 2], ("x", None)], row_ids=["a", "b"], actions=["Edit"])
    assert t == {
        "type": "table",
        "headers": ["A", "B"],
        "rows": [[1, 2], ["x", None]],
        "row_ids": ["a", "b"],
        "actions": ["Edit"],
    }


def test_columns_give_headers_and_accept_labels():
    t = table(
        columns=["Name", {"key": "views", "label": "Views", "type": "number", "format": "compact"}],
        rows=[["a", 1200]],
    )
    assert t["headers"] == ["Name", "Views"]
    assert t["columns"] == [
        {"key": "Name", "label": "Name"},
        {"key": "views", "label": "Views", "type": "number", "format": "compact"},
    ]


def test_dict_rows_become_arrays_in_column_order():
    t = table(
        columns=[{"key": "name"}, {"key": "subs", "type": "number"}],
        rows=[{"subs": 5, "name": "x", "extra": 1}],
    )
    assert t["rows"] == [["x", 5]]
    # Rows stay arrays, so the legacy dashboard renderer still draws them.
    assert all(isinstance(r, list) for r in t["rows"])


def test_href_key_makes_link_cells_and_is_not_sent():
    t = table(
        columns=[{"key": "name", "type": "link", "href_key": "url"}, "subs"],
        rows=[
            {"name": "Chan", "url": "https://example.com/c", "subs": 3},
            {"name": "No link", "subs": 1},
        ],
    )
    assert t["rows"][0][0] == {"text": "Chan", "href": "https://example.com/c"}
    assert t["rows"][1][0] == "No link"
    assert "href_key" not in t["columns"][0]


def test_row_href_key_and_detail_key():
    detail = [{"type": "text", "content": "hi"}]
    t = table(
        columns=["name"],
        rows=[{"name": "a", "url": "/a", "more": detail}, {"name": "b", "url": ""}],
        row_href_key="url",
        detail_key="more",
    )
    assert t["row_hrefs"] == ["/a", None]
    assert t["row_details"] == [detail, []]
    assert t["row_detail"] is True


def test_row_href_key_reads_a_column_of_array_rows():
    t = table(headers=["Name", "Link"], rows=[["a", "/a"]], row_href_key="Link")
    assert t["row_hrefs"] == ["/a"]


def test_options_only_appear_when_set():
    t = table(
        headers=["A"],
        rows=[[1]],
        searchable=True,
        page_size=0,
        sortable=False,
        row_detail=True,
        max_height=400,
        caption="Items",
    )
    assert {
        k: t[k]
        for k in ("searchable", "page_size", "sortable", "row_detail", "max_height", "caption")
    } == {
        "searchable": True,
        "page_size": 0,
        "sortable": False,
        "row_detail": True,
        "max_height": 400,
        "caption": "Items",
    }
    assert set(table(headers=["A"], rows=[]).keys()) == {"type", "headers", "rows"}


def test_large_table_is_json_serialisable():
    rows = [
        {"name": f"c{i}", "subs": i * 1000, "tags": ["ai", "news"], "url": f"/c/{i}"}
        for i in range(1100)
    ]
    t = table(
        columns=[
            {"key": "name"},
            {"key": "subs", "type": "number", "format": "compact"},
            {"key": "tags", "type": "tag"},
        ],
        rows=rows,
        searchable=True,
        row_href_key="url",
    )
    assert len(t["rows"]) == 1100 and len(t["row_hrefs"]) == 1100
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
