---
nav_title: Build a focused app
description: A dashboard with only your pages, in the new app shell, with its own chat history.
---

# Build a focused app

Your own pages, Chat when you have a `@reply`, and nothing else: no built-in
tabs, no pages from other apps on the machine, no other apps' chats.

## The whole app

```python
# app.py  ->  aiui run app.py
import praisonaiui as aiui

aiui.set_style("app")        # the new shell (already the default; says so)
aiui.only_my_pages("chat")   # my pages + Chat; same as aiui.set_pages(["chat"])


@aiui.page("posts", title="My posts", icon="📈", group="My posts", order=1)
async def posts():
    return aiui.layout([
        aiui.columns([aiui.metric("Posts", value=42), aiui.metric("Best", value="12.4k")]),
        aiui.table(headers=["Hook", "Views"], rows=[["I replaced my IDE", "12,400"]]),
    ])


@aiui.page("links", title="Links", icon="🔗", group="My posts", order=2)
async def links():
    return aiui.layout([aiui.markdown_text("- [YouTube Studio](https://studio.youtube.com)")])


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

```bash
uv pip install -U aiui        # always start from the latest release
aiui run app.py               # opens http://127.0.0.1:8000
```

The sidebar shows Chat and a **My posts** group with your two pages. Every
layout of the app shell lists your pages in their group, and the layout
picker still works.

## What each line does

| You want | Use |
|---|---|
| The new app shell | Nothing: `style: app` is the default. `aiui.set_style("app")` makes it explicit |
| Only your pages | `aiui.only_my_pages()` or `aiui.set_pages([])` |
| Your pages and Chat | `aiui.only_my_pages("chat")` or `aiui.set_pages(["chat"])` |
| A few built-in pages too | `aiui.set_pages(["chat", "sessions", "usage"])` (ids: `aiui pages ids`) |
| Every page (the full product) | `aiui.set_pages("all")` or `aiui run app.py --pages all` |

`set_pages` is the one switch for what shows. It covers built-in pages, the
app shell's layout pages (`start`, `artifacts`, `templates`, `connect`,
`api-reference`) and dashboard-plugin folders, including the ones in
`~/.praisonai/dashboard-plugins` that every app on the machine would
otherwise share. Pages you register yourself (`@aiui.page`,
`aiui.register_page`, `aiui.register_plugin`) always show. A wrong id is
reported at startup: `set_pages() names 'chta', but no page has that id`.

## Add pages and links

- A server-driven page: `@aiui.page(id, title=..., icon=..., group=..., order=...)`
  returning `aiui.layout([...])` of blocks (`aiui.metric`, `aiui.table`,
  `aiui.columns`, `aiui.markdown_text`, `aiui.card`, ...). Pages with the same
  `group` sit together in the sidebar; `order` sorts them.
- Links: a page of markdown links, as `links` above.
- A React page or a whole plugin: see [UI Plugins](../features/plugins.md).

## Your own data

`aiui run app.py` keeps the app's chats in its own folder,
`~/.praisonaiui/apps/<file name>-<hash>/sessions/`, so the sidebar never
lists the chats of other apps or agents. Point it elsewhere with
`--datastore sdk:/path` (or `json:/path`), or share the old machine-wide
history with `--datastore sdk`. Set `AIUI_DATA_DIR` to move everything aiui
keeps (config, sessions) for one app. See [Sessions](../features/sessions.md).

## Show everything

`aiui.set_pages("all")` (or `aiui run app.py --pages all`) is the opposite
of a focused app: every page of the product, each in its React version where
there is one and otherwise the legacy view inside the new shell, with every
group (Agent, Work, Control, ...) listed in the sidebar of whatever layout is
on. Your own pages still show in their group.

## Check it before you call it done

```bash
aiui doctor                   # warns when aiui is older than PyPI's latest
AIUI_NO_BROWSER=1 aiui run app.py --port 8765 &
curl -s http://127.0.0.1:8765/api/shell/manifest | python -c \
  "import json,sys; print(sorted(p['id'] for p in json.load(sys.stdin)['pages']))"
```

The list must hold only your page ids (and `chat`). Then open the page in a
headless browser and look at the sidebar.

## The legacy dashboard

`style: dashboard` is the old vanilla UI. It still works
(`aiui run app.py --style dashboard`, `aiui.set_style("dashboard")`, YAML
`style: dashboard` or `AIUI_SHELL=legacy`, which prints a one-line notice),
and `set_pages` applies there too, but new apps should not use it. Docs and
examples that pass `--style dashboard` describe the legacy UI.
