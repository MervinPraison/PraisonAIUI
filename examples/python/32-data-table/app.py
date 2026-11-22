"""Data table: typed columns, sorting, search, paging, row links and a detail panel.

1,100 generated rows show the default paging (50 per page past 100 rows).
Click a header to sort, type in the search box, click a row to open its panel.

Run:
    aiui run app.py
"""

import random

import praisonaiui as aiui

TOPICS = ["ai", "news", "coding", "agents", "video", "research"]
STATUS = ["growing", "flat", "down"]

rng = random.Random(7)
CHANNELS = [
    {
        "name": f"Channel {i:04d}",
        "url": f"https://example.com/channels/{i}",
        "subs": rng.randint(200, 4_000_000),
        "lift": round(rng.uniform(0.2, 4.0), 2),
        "share": round(rng.random(), 3),
        "status": rng.choice(STATUS),
        "topics": rng.sample(TOPICS, 2),
        "last": f"2026-{rng.randint(1, 11):02d}-{rng.randint(1, 28):02d}",
    }
    for i in range(1100)
]
for c in CHANNELS:
    c["panel"] = [
        aiui.metric("Subscribers", value=f"{c['subs']:,}"),
        aiui.text(f"{c['name']} posts about {' and '.join(c['topics'])}."),
        aiui.link("Open channel", href=c["url"]),
    ]


@aiui.page("channels", title="Channels", icon="table", group="Data")
async def channels():
    return aiui.layout(
        [
            aiui.table(
                columns=[
                    {"key": "name", "label": "Channel", "type": "link", "href_key": "url"},
                    {"key": "subs", "label": "Subscribers", "type": "number", "format": "compact"},
                    {"key": "lift", "label": "Lift", "type": "number", "format": "multiplier"},
                    {"key": "share", "label": "Share", "type": "progress"},
                    {
                        "key": "status",
                        "label": "Status",
                        "type": "badge",
                        "tones": {"growing": "success", "flat": "warning", "down": "error"},
                    },
                    {"key": "topics", "label": "Topics", "type": "tag"},
                    {"key": "last", "label": "Last post", "type": "date"},
                ],
                rows=CHANNELS,
                searchable=True,
                caption="Channels",
                detail_key="panel",
            ),
        ]
    )
