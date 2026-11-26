---
nav_title: Server pages
description: Pages built in Python with @aiui.page and aiui blocks - filters in the URL, forms and page actions, lazy tabs, auto refresh and job status.
---

# Server pages

A server page is a Python function that returns blocks. The app shell
(`style: app`, the default) fetches them from `GET /api/pages/{id}/data` and
renders them; forms and buttons talk back through `POST /api/pages/{id}/action`.
Both endpoints sit behind the same auth as every other `/api/*` route.

This guide builds a filter page step by step. Each part works on its own.

## 1. A page

`@aiui.page("channels", title="Channels")` on a function that returns
`aiui.layout([...])` (`{"_components": [...]}`) makes a page; every helper in
`aiui` (`metric`, `table`, `tabs`, `form`, ...) is a block, see
[Components](../api/components.md). `aiui.register_page(id, title=..., handler=fn)`
does the same without the decorator. Run the app with `aiui run app.py`.

## 2. Page parameters: filters in the URL

A handler that takes `params` receives the page URL's query string as a dict.
A key given once is a string; a key given more than once is a list:

```
/channels?format=shorts&tag=ai&tag=dev   ->   {"format": "shorts", "tag": ["ai", "dev"]}
```

The handler is matched by its signature: a parameter named `params` (or
`**kwargs`) gets it by keyword, a single required positional parameter gets it
positionally, and a handler with no parameters is called as before.

The app shell sends the URL's query string with every data request, so a
filtered view survives a refresh, a bookmark and a shared link. The page's
Refresh button re-fetches with the current params.

## 3. Forms

`aiui.form(action_id, children=[...], submit_label=...)` collects every input
inside it by `name` (or by its label when it has no `name`). Give inputs a
`name` so the keys are stable. The first argument is the action id, normally
the page id.

There are two ways to submit.

### `method="get"`: filters

The values are written into the page URL (`history.replaceState`) and the page
data is fetched again, so the page handler sees them in `params`. No action
handler is needed. This is the right choice for a filter form:

```python
FORMATS = ["all", "long", "shorts"]


@aiui.page("channels", title="Channels", icon="📺", group="Research")
async def channels(params):
    fmt = params.get("format", "all")
    query = params.get("q", "")
    rows = [r for r in load_channels() if matches(r, fmt, query)]
    return aiui.layout([
        aiui.form("channels", method="get", submit_label="Apply", children=[
            aiui.columns([
                aiui.text_input("Search", name="q", value=query),
                aiui.select_input("Format", name="format", options=FORMATS, value=fmt),
            ]),
        ]),
        aiui.table(headers=["Name", "Format"], rows=[[r.name, r.format] for r in rows]),
    ])
```

Render each input with `value=` taken from `params`, so the form shows the
active filters after a refresh. An empty value removes its key from the URL;
other keys in the URL stay. Keys starting with `_` are never written.

### `method="post"` (default): page actions

The values are POSTed as JSON to `/api/pages/{page_id}/action`. Handle them
with `aiui.register_page_action(page_id)`:

```python
@aiui.register_page_action("channels")
async def channels_action(data):
    if data.get("action") == "sync":            # a button: aiui.button_group([{"label": "Sync", "action": "sync"}])
        start_sync()
        return {"message": "Sync started"}       # a toast
    save_note(data["note"])                     # a form: the inputs by name
    return aiui.layout([...])                   # re-renders the page
```

What the reply can hold:

| Key | Effect in the app shell |
|-----|-------------------------|
| `_components` | Replaces the page with these blocks (return `aiui.layout([...])`). |
| `message` (or `status`) | A success toast. With `_components`, both happen. |
| `error` | An error toast; the page is left as it was. |
| `_params` | Written into the page URL's query string (`aiui.layout([...], params={...})`); `None` or `""` removes a key. |
| `_refresh_every` | Starts or changes auto refresh (section 5). |

`aiui.form(..., update_url=True)` writes the submitted values into the URL
after a successful POST, as `method="get"` does. Use it when the action both
does something and changes the view; a reply's `_params` wins over it.

A button posts `{**payload, "action": action, "_params": {...}}`. A form posts
its values alongside `"_params"` (the page URL's current query string, same
dict shape as `params` in the page handler).

## 4. Lazy tabs and expanders

Heavy sections can load when they are first opened instead of with the page:

```python
@aiui.page("youtube", title="YouTube", icon="▶️", group="Research")
async def youtube(params):
    return aiui.layout([
        aiui.tabs([
            {"label": "Overview", "children": [aiui.metric("Views", value="1.2M")]},  # eager
            {"label": "Retention", "load": "retention"},                              # lazy
            {"label": "Traffic", "load": "traffic"},
        ], lazy=True),
        aiui.expander("Every video", lazy=True, load="videos"),
    ])


@aiui.register_page_action("youtube")
async def youtube_action(data):
    key = data.get("_lazy")
    params = data.get("_params", {})       # the page URL's query string
    if key == "retention":
        return aiui.layout([retention_chart(params)])
    if key == "traffic":
        return aiui.layout([traffic_table(params)])
    if key == "videos":
        return aiui.layout([videos_table(params)])
    return {"error": f"Unknown section {key!r}"}
```

- With `lazy=True`, a tab item without `children` is lazy; its key is its
  `load` value, or its `label`. An item with `children` renders at once.
- `aiui.expander(title, lazy=True, load=key)`: the key defaults to the title.
- The body is fetched with `POST /api/pages/{id}/action` and the JSON body
  `{"_lazy": key, "_params": {...}}`. Reply with `_components`, as for any
  action. A reply with `error` (or an HTTP error) shows the message and a
  "Try again" button; a skeleton shows while it loads.
- Once loaded, a section stays loaded. When the page data reloads (Refresh,
  auto refresh, an action that re-renders), open sections fetch again; a
  closed one fetches again the next time it opens.

## 5. Auto refresh and job status

`refresh_every` (seconds, at least 1) re-fetches the page while its browser
tab is visible. It pauses while the tab is hidden and resumes when it is shown
again. After a failure it keeps the last good content, shows one error toast
and doubles the wait on each failure in a row (up to 5 minutes).

Set it when you register the page, or per reply (a reply's value wins, so a
page can refresh only while something runs):

```python
@aiui.page("sync", title="Sync", icon="🔄", group="Research")
async def sync():
    jobs = list_jobs()  # your job store
    rows = [
        # state: "queued" | "running" | "done" | "failed"; progress 0-100 or None
        aiui.status(j.name, state=j.state, detail=j.detail, progress=j.percent, log=j.lines[-20:])
        for j in jobs
    ]
    running = any(j.state in ("queued", "running") for j in jobs)
    return aiui.layout(
        [aiui.button_group([{"label": "Sync now", "action": "sync"}]), *rows],
        refresh_every=3 if running else None,
    )


@aiui.register_page_action("sync")
async def sync_action(data):
    start_sync()
    # Re-render, so the reply's _refresh_every starts the polling.
    return {**await sync(), "message": "Sync started"}
```

`@aiui.page(..., refresh_every=10)` and
`aiui.register_page(..., refresh_every=10)` set a fixed period; the data
reply carries it as `_refresh_every` unless the handler set that key.

`@aiui.page(..., badge=...)` and `aiui.register_page(..., badge=...)` show a
short pill beside the page title in the app shell sidebar. Pass a string, an
integer, or a zero-argument callable (evaluated when the manifest is served)
for live counts such as unread items or queued jobs.

## Shell support

The app shell supports everything in this guide. The legacy `dashboard`
style renders the page and its forms. It ignores `params`, `method="get"`,
lazy loading and `refresh_every`, and shows a status as plain text.
