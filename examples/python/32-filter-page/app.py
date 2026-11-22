"""A filter page: a filter bar over a table, applied on every change.

    aiui run examples/python/32-filter-page/app.py

The bar posts its inputs to the page action; the handler rebuilds the page
from them, so chips, Reset and the table always match the filters.
"""

import datetime as dt
import random

import praisonaiui as aiui

rng = random.Random(7)
CHANNELS = [f"Channel {i:04d}" for i in range(1, 1096)]
FORMATS = ["Video", "Short", "Live", "Post"]
TODAY = dt.date.today()
POSTS = [
    {
        "channel": rng.choice(CHANNELS[:40]),
        "format": rng.choice(FORMATS),
        "date": (TODAY - dt.timedelta(days=rng.randint(0, 400))).isoformat(),
        "views": rng.randint(100, 90_000),
        "tags": rng.sample(["ai", "agents", "tools", "news"], 2),
    }
    for _ in range(300)
]
DEFAULTS = {"channel": "All", "sort": "views"}


def build(f: dict) -> dict:
    channel = f.get("channel") or "All"
    formats = f.get("formats") or []
    tags = f.get("tags") or []
    start, end = f.get("posted_start") or "", f.get("posted_end") or ""
    sort = f.get("sort") or "views"
    rows = [
        p
        for p in POSTS
        if (channel == "All" or p["channel"] == channel)
        and (not formats or p["format"] in formats)
        and (not tags or set(tags) & set(p["tags"]))
        and (not start or p["date"] >= start)
        and (not end or p["date"] <= end)
    ]
    rows.sort(key=lambda p: p[sort], reverse=True)
    bar = aiui.filter_bar(
        "explore",
        defaults=DEFAULTS,
        inputs=[
            aiui.select_input("Channel", options=["All", *CHANNELS], value=channel, name="channel"),
            aiui.multiselect_input("Format", options=FORMATS, value=formats, name="formats"),
            aiui.tags_input("Tags", value=tags, name="tags"),
            aiui.date_range_input("posted", label="Posted", start=start, end=end),
            aiui.segmented_input("sort", [{"value": "views", "label": "Views"}, {"value": "date", "label": "Newest"}], label="Sort", value=sort),
        ],
    )
    table = aiui.table(
        headers=["Channel", "Format", "Date", "Views"],
        rows=[[p["channel"], p["format"], p["date"], f"{p['views']:,}"] for p in rows[:25]],
    )
    return aiui.layout([bar, aiui.caption(f"{len(rows)} posts"), table])


@aiui.page("explore", title="Explore posts", icon="search")
async def explore():
    return build({})


@aiui.register_page_action("explore")
async def explore_action(data: dict):
    return build(data)
