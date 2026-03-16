"""Tests for all 54 UI component functions in praisonaiui.ui."""

from __future__ import annotations

import pytest

from praisonaiui.ui import (
    # Existing (6)
    layout,
    card,
    columns,
    chart,
    table,
    text,
    # Tier 1 (10)
    metric,
    progress_bar,
    alert,
    badge,
    separator,
    tabs,
    accordion,
    image_display,
    code_block,
    json_view,
    # Tier 2 — form inputs (8)
    text_input,
    number_input,
    select_input,
    slider_input,
    checkbox_input,
    switch_input,
    radio_input,
    textarea_input,
    # Tier 3 — layout & advanced (12)
    container,
    expander,
    divider,
    link,
    button_group,
    stat_group,
    header,
    markdown_text,
    empty,
    spinner,
    avatar,
    callout,
    # Tier A — must-have parity (6)
    multiselect_input,
    date_input,
    color_picker_input,
    audio_player,
    video_player,
    file_download,
    # Tier B — high-value dashboard (6)
    toast,
    dialog,
    caption,
    html_embed,
    skeleton,
    tooltip_wrap,
    # Tier C — completeness (6)
    time_input,
    gallery,
    breadcrumb,
    pagination,
    key_value_list,
    popover,
)


# ── Existing components (regression) ─────────────────────────────────


class TestLayout:
    def test_wraps_children(self):
        result = layout([card("A"), text("B")])
        assert "_components" in result
        assert len(result["_components"]) == 2

    def test_empty(self):
        assert layout([]) == {"_components": []}


class TestCard:
    def test_minimal(self):
        c = card("Users")
        assert c == {"type": "card", "title": "Users"}

    def test_full(self):
        c = card("Revenue", value="$1k", footer="+8%")
        assert c["type"] == "card"
        assert c["value"] == "$1k"
        assert c["footer"] == "+8%"

    def test_none_value_omitted(self):
        c = card("X")
        assert "value" not in c


class TestColumns:
    def test_basic(self):
        c = columns([card("A"), card("B")])
        assert c["type"] == "columns"
        assert len(c["children"]) == 2


class TestChart:
    def test_defaults(self):
        c = chart("Sales")
        assert c == {"type": "chart", "title": "Sales", "data": [], "chart_type": "bar"}

    def test_with_data(self):
        c = chart("Sales", data=[{"x": 1}], chart_type="line")
        assert c["chart_type"] == "line"
        assert len(c["data"]) == 1


class TestTable:
    def test_basic(self):
        t = table(headers=["A", "B"], rows=[[1, 2]])
        assert t["type"] == "table"
        assert t["headers"] == ["A", "B"]
        assert t["rows"] == [[1, 2]]


class TestText:
    def test_basic(self):
        assert text("hello") == {"type": "text", "content": "hello"}


# ── Tier 1 components ────────────────────────────────────────────────


class TestMetric:
    def test_minimal(self):
        m = metric("Users", value=42)
        assert m["type"] == "metric"
        assert m["label"] == "Users"
        assert m["value"] == 42
        assert "delta" not in m

    def test_with_delta(self):
        m = metric("Users", value=42, delta="+5%", delta_color="inverse")
        assert m["delta"] == "+5%"
        assert m["delta_color"] == "inverse"

    def test_default_delta_color_omitted(self):
        m = metric("X", value=1)
        assert "delta_color" not in m


class TestProgressBar:
    def test_basic(self):
        p = progress_bar("Upload", value=75)
        assert p == {"type": "progress_bar", "label": "Upload", "value": 75, "max_value": 100}

    def test_custom_max(self):
        p = progress_bar("Steps", value=3, max_value=10)
        assert p["max_value"] == 10


class TestAlert:
    def test_defaults(self):
        a = alert("Something happened")
        assert a["type"] == "alert"
        assert a["message"] == "Something happened"
        assert a["variant"] == "info"
        assert "title" not in a

    def test_with_title(self):
        a = alert("Oops", variant="error", title="Error")
        assert a["title"] == "Error"
        assert a["variant"] == "error"


class TestBadge:
    def test_default(self):
        b = badge("New")
        assert b == {"type": "badge", "text": "New", "variant": "default"}

    def test_variant(self):
        b = badge("Danger", variant="destructive")
        assert b["variant"] == "destructive"


class TestSeparator:
    def test_basic(self):
        assert separator() == {"type": "separator"}


class TestTabs:
    def test_basic(self):
        items = [{"label": "Tab1", "children": [text("Content1")]}]
        t = tabs(items)
        assert t["type"] == "tabs"
        assert len(t["items"]) == 1
        assert t["items"][0]["label"] == "Tab1"


class TestAccordion:
    def test_basic(self):
        items = [{"title": "Section1", "content": "Hello"}]
        a = accordion(items)
        assert a["type"] == "accordion"
        assert len(a["items"]) == 1


class TestImageDisplay:
    def test_minimal(self):
        i = image_display("https://example.com/img.png")
        assert i["type"] == "image_display"
        assert i["src"] == "https://example.com/img.png"
        assert i["alt"] == ""
        assert "caption" not in i
        assert "width" not in i

    def test_full(self):
        i = image_display("img.png", alt="Photo", caption="A photo", width="300px")
        assert i["caption"] == "A photo"
        assert i["width"] == "300px"


class TestCodeBlock:
    def test_defaults(self):
        c = code_block("print('hi')")
        assert c == {"type": "code_block", "code": "print('hi')", "language": "text"}

    def test_language(self):
        c = code_block("x = 1", language="python")
        assert c["language"] == "python"


class TestJsonView:
    def test_dict(self):
        j = json_view({"a": 1})
        assert j["type"] == "json_view"
        assert j["data"] == {"a": 1}

    def test_list(self):
        j = json_view([1, 2, 3])
        assert j["data"] == [1, 2, 3]


# ── Tier 2: Form Inputs ─────────────────────────────────────────────


class TestTextInput:
    def test_defaults(self):
        t = text_input("Name")
        assert t == {"type": "text_input", "label": "Name", "value": "", "placeholder": ""}

    def test_with_values(self):
        t = text_input("Name", value="Alice", placeholder="Enter name")
        assert t["value"] == "Alice"
        assert t["placeholder"] == "Enter name"


class TestNumberInput:
    def test_defaults(self):
        n = number_input("Age")
        assert n["type"] == "number_input"
        assert n["value"] == 0
        assert n["step"] == 1
        assert "min_val" not in n
        assert "max_val" not in n

    def test_full(self):
        n = number_input("Age", value=25, min_val=0, max_val=150, step=1)
        assert n["min_val"] == 0
        assert n["max_val"] == 150


class TestSelectInput:
    def test_basic(self):
        s = select_input("Color", options=["Red", "Blue"])
        assert s["type"] == "select_input"
        assert s["options"] == ["Red", "Blue"]
        assert s["value"] == ""

    def test_default_value(self):
        s = select_input("Color", options=["Red", "Blue"], value="Blue")
        assert s["value"] == "Blue"


class TestSliderInput:
    def test_defaults(self):
        s = slider_input("Volume")
        assert s == {
            "type": "slider_input", "label": "Volume",
            "value": 0, "min_val": 0, "max_val": 100, "step": 1,
        }

    def test_custom(self):
        s = slider_input("Temp", value=50, min_val=-10, max_val=50, step=5)
        assert s["min_val"] == -10


class TestCheckboxInput:
    def test_unchecked(self):
        c = checkbox_input("Agree")
        assert c == {"type": "checkbox_input", "label": "Agree", "checked": False}

    def test_checked(self):
        c = checkbox_input("Agree", checked=True)
        assert c["checked"] is True


class TestSwitchInput:
    def test_defaults(self):
        s = switch_input("Dark mode")
        assert s == {"type": "switch_input", "label": "Dark mode", "checked": False}

    def test_checked(self):
        s = switch_input("Notify", checked=True)
        assert s["checked"] is True


class TestRadioInput:
    def test_basic(self):
        r = radio_input("Size", options=["S", "M", "L"])
        assert r["type"] == "radio_input"
        assert r["options"] == ["S", "M", "L"]
        assert r["value"] == ""

    def test_default_value(self):
        r = radio_input("Size", options=["S", "M", "L"], value="M")
        assert r["value"] == "M"


class TestTextareaInput:
    def test_defaults(self):
        t = textarea_input("Bio")
        assert t == {"type": "textarea_input", "label": "Bio", "value": "", "placeholder": "", "rows": 4}

    def test_custom(self):
        t = textarea_input("Notes", value="hello", rows=8)
        assert t["rows"] == 8


# ── Tier 3: Layout & Advanced ────────────────────────────────────────


class TestContainer:
    def test_without_title(self):
        c = container([text("hi")])
        assert c["type"] == "container"
        assert len(c["children"]) == 1
        assert "title" not in c

    def test_with_title(self):
        c = container([text("hi")], title="Section")
        assert c["title"] == "Section"


class TestExpander:
    def test_defaults(self):
        e = expander("Details", children=[text("info")])
        assert e["type"] == "expander"
        assert e["title"] == "Details"
        assert e["expanded"] is False

    def test_expanded(self):
        e = expander("Details", children=[text("info")], expanded=True)
        assert e["expanded"] is True


class TestDivider:
    def test_plain(self):
        d = divider()
        assert d == {"type": "divider"}

    def test_with_text(self):
        d = divider("OR")
        assert d == {"type": "divider", "text": "OR"}


class TestLink:
    def test_internal(self):
        l = link("Home", href="/")
        assert l == {"type": "link", "text": "Home", "href": "/", "external": False}

    def test_external(self):
        l = link("Docs", href="https://docs.example.com", external=True)
        assert l["external"] is True


class TestButtonGroup:
    def test_basic(self):
        bg = button_group([{"label": "Save", "variant": "default"}, {"label": "Cancel", "variant": "outline"}])
        assert bg["type"] == "button_group"
        assert len(bg["buttons"]) == 2


class TestStatGroup:
    def test_basic(self):
        sg = stat_group([{"label": "Users", "value": 42, "delta": "+5%"}])
        assert sg["type"] == "stat_group"
        assert len(sg["stats"]) == 1


class TestHeader:
    def test_default_level(self):
        h = header("Title")
        assert h == {"type": "header", "text": "Title", "level": 1}

    def test_custom_level(self):
        h = header("Subtitle", level=3)
        assert h["level"] == 3


class TestMarkdownText:
    def test_basic(self):
        m = markdown_text("# Hello\n\nWorld")
        assert m == {"type": "markdown_text", "content": "# Hello\n\nWorld"}


class TestEmpty:
    def test_default(self):
        e = empty()
        assert e == {"type": "empty", "text": "No data"}

    def test_custom(self):
        e = empty("Nothing here")
        assert e["text"] == "Nothing here"


class TestSpinner:
    def test_default(self):
        s = spinner()
        assert s == {"type": "spinner", "text": "Loading..."}

    def test_custom(self):
        s = spinner("Please wait...")
        assert s["text"] == "Please wait..."


class TestAvatar:
    def test_empty(self):
        a = avatar()
        assert a == {"type": "avatar"}

    def test_full(self):
        a = avatar(src="photo.jpg", name="Alice", fallback="AL")
        assert a["src"] == "photo.jpg"
        assert a["name"] == "Alice"
        assert a["fallback"] == "AL"


class TestCallout:
    def test_defaults(self):
        c = callout("Note this")
        assert c["type"] == "callout"
        assert c["content"] == "Note this"
        assert c["variant"] == "info"
        assert "title" not in c

    def test_with_title(self):
        c = callout("Warning!", variant="warning", title="Heads up")
        assert c["title"] == "Heads up"
        assert c["variant"] == "warning"


# ── Composition tests ────────────────────────────────────────────────


class TestComposition:
    def test_nested_layout(self):
        result = layout([
            columns([
                card("A", value=1),
                card("B", value=2),
            ]),
            tabs([
                {"label": "Tab1", "children": [text("Content")]},
            ]),
        ])
        assert len(result["_components"]) == 2
        assert result["_components"][0]["type"] == "columns"
        assert result["_components"][1]["type"] == "tabs"

    def test_stat_group_in_container(self):
        result = container([
            stat_group([
                {"label": "Users", "value": 42, "delta": "+5%"},
                {"label": "Revenue", "value": "$1k", "delta": "+8%"},
            ]),
        ], title="Stats")
        assert result["type"] == "container"
        assert result["children"][0]["type"] == "stat_group"

    def test_all_types_produce_type_key(self):
        """Every component (except layout) must have a 'type' key."""
        components = [
            card("X"), columns([]), chart("X"), table(headers=["A"], rows=[]),
            text("X"), metric("X", value=1), progress_bar("X", value=50),
            alert("X"), badge("X"), separator(), tabs([]), accordion([]),
            image_display("x.png"), code_block("x"), json_view({}),
            text_input("X"), number_input("X"), select_input("X", options=[]),
            slider_input("X"), checkbox_input("X"), switch_input("X"),
            radio_input("X", options=[]), textarea_input("X"),
            container([]), expander("X", children=[]), divider(),
            link("X", href="/"), button_group([]), stat_group([]),
            header("X"), markdown_text("X"), empty(), spinner(),
            avatar(), callout("X"),
            # Tier A
            multiselect_input("X", options=[]), date_input("X"),
            color_picker_input("X"), audio_player("x.mp3"),
            video_player("x.mp4"), file_download("X", href="/f"),
            # Tier B
            toast("X"), dialog("X", children=[]), caption("X"),
            html_embed("<b>X</b>"), skeleton(), tooltip_wrap(text("X"), content="tip"),
            # Tier C
            time_input("X"), gallery([]), breadcrumb([]),
            pagination(total=100), key_value_list([]), popover(text("X"), children=[]),
        ]
        for comp in components:
            assert "type" in comp, f"Missing 'type' key in {comp}"


# ── Tier A: Must-Have Parity ─────────────────────────────────────────


class TestMultiselectInput:
    def test_defaults(self):
        m = multiselect_input("Tags", options=["A", "B", "C"])
        assert m["type"] == "multiselect_input"
        assert m["options"] == ["A", "B", "C"]
        assert m["value"] == []

    def test_with_values(self):
        m = multiselect_input("Tags", options=["A", "B"], value=["A"])
        assert m["value"] == ["A"]


class TestDateInput:
    def test_no_default(self):
        d = date_input("Birthday")
        assert d == {"type": "date_input", "label": "Birthday"}
        assert "value" not in d

    def test_with_value(self):
        d = date_input("Start", value="2026-01-15")
        assert d["value"] == "2026-01-15"


class TestColorPickerInput:
    def test_default(self):
        c = color_picker_input("Theme")
        assert c == {"type": "color_picker_input", "label": "Theme", "value": "#000000"}

    def test_custom(self):
        c = color_picker_input("Accent", value="#ff5733")
        assert c["value"] == "#ff5733"


class TestAudioPlayer:
    def test_basic(self):
        a = audio_player("song.mp3")
        assert a == {"type": "audio_player", "src": "song.mp3", "autoplay": False}

    def test_autoplay(self):
        a = audio_player("song.mp3", autoplay=True)
        assert a["autoplay"] is True


class TestVideoPlayer:
    def test_basic(self):
        v = video_player("clip.mp4")
        assert v["type"] == "video_player"
        assert v["src"] == "clip.mp4"
        assert v["autoplay"] is False
        assert "poster" not in v

    def test_with_poster(self):
        v = video_player("clip.mp4", poster="thumb.jpg")
        assert v["poster"] == "thumb.jpg"


class TestFileDownload:
    def test_basic(self):
        f = file_download("Download CSV", href="/data.csv")
        assert f["type"] == "file_download"
        assert f["label"] == "Download CSV"
        assert f["href"] == "/data.csv"
        assert "filename" not in f

    def test_with_filename(self):
        f = file_download("Get Report", href="/api/report", filename="report.pdf")
        assert f["filename"] == "report.pdf"


# ── Tier B: High-Value Dashboard ─────────────────────────────────────


class TestToast:
    def test_defaults(self):
        t = toast("Saved!")
        assert t == {"type": "toast", "message": "Saved!", "variant": "info", "duration": 3000}

    def test_custom(self):
        t = toast("Error!", variant="error", duration=5000)
        assert t["variant"] == "error"
        assert t["duration"] == 5000


class TestDialog:
    def test_basic(self):
        d = dialog("Confirm", children=[text("Are you sure?")])
        assert d["type"] == "dialog"
        assert d["title"] == "Confirm"
        assert len(d["children"]) == 1
        assert "description" not in d

    def test_with_description(self):
        d = dialog("Settings", children=[], description="App configuration")
        assert d["description"] == "App configuration"


class TestCaption:
    def test_basic(self):
        c = caption("Updated 5 min ago")
        assert c == {"type": "caption", "text": "Updated 5 min ago"}


class TestHtmlEmbed:
    def test_basic(self):
        h = html_embed("<iframe src='x'></iframe>")
        assert h == {"type": "html_embed", "content": "<iframe src='x'></iframe>"}


class TestSkeleton:
    def test_defaults(self):
        s = skeleton()
        assert s == {"type": "skeleton", "variant": "text"}
        assert "width" not in s
        assert "height" not in s

    def test_custom(self):
        s = skeleton(width="200px", height="20px", variant="card")
        assert s["width"] == "200px"
        assert s["height"] == "20px"
        assert s["variant"] == "card"


class TestTooltipWrap:
    def test_basic(self):
        t = tooltip_wrap(badge("?"), content="Help text")
        assert t["type"] == "tooltip_wrap"
        assert t["child"]["type"] == "badge"
        assert t["content"] == "Help text"


# ── Tier C: Completeness ─────────────────────────────────────────────


class TestTimeInput:
    def test_no_default(self):
        t = time_input("Alarm")
        assert t == {"type": "time_input", "label": "Alarm"}
        assert "value" not in t

    def test_with_value(self):
        t = time_input("Meeting", value="14:30")
        assert t["value"] == "14:30"


class TestGallery:
    def test_basic(self):
        g = gallery([{"src": "a.jpg", "alt": "A"}, {"src": "b.jpg", "alt": "B"}])
        assert g["type"] == "gallery"
        assert len(g["items"]) == 2

    def test_empty(self):
        g = gallery([])
        assert g["items"] == []


class TestBreadcrumb:
    def test_basic(self):
        b = breadcrumb([{"label": "Home", "href": "/"}, {"label": "Settings", "href": None}])
        assert b["type"] == "breadcrumb"
        assert len(b["items"]) == 2
        assert b["items"][1]["href"] is None


class TestPagination:
    def test_defaults(self):
        p = pagination(total=100)
        assert p == {"type": "pagination", "total": 100, "page": 1, "per_page": 10}

    def test_custom(self):
        p = pagination(total=500, page=3, per_page=25)
        assert p["page"] == 3
        assert p["per_page"] == 25


class TestKeyValueList:
    def test_without_title(self):
        k = key_value_list([{"label": "Name", "value": "Alice"}])
        assert k["type"] == "key_value_list"
        assert len(k["items"]) == 1
        assert "title" not in k

    def test_with_title(self):
        k = key_value_list([{"label": "CPU", "value": "72%"}], title="System Info")
        assert k["title"] == "System Info"


class TestPopover:
    def test_basic(self):
        p = popover(badge("?"), children=[text("Help content")])
        assert p["type"] == "popover"
        assert p["trigger"]["type"] == "badge"
        assert len(p["children"]) == 1
