# Selectable layouts

A layout is the frame of the app shell (`style: app`): the navigation, the session list, the top
bar and the side panels around the page you are on. Every page renders inside every layout. The
design is in [ADR 0003](../adr/0003-selectable-layouts.md).

Five layouts ship with PraisonAIUI:

| Id | Title | Opens on | Primary nav |
|---|---|---|---|
| `chat-canvas` (default) | Chat and Canvas | `chat` | chat, artifacts, agents, cron, knowledge, sessions, config |
| `workbench` | Quiet Workbench | `chat` | chat, agents, knowledge, runs, config |
| `command` | Command Deck | `chat` | chat, runs, agents, jobs, config |
| `guided` | Guided Studio | `chat` (`start` **(planned, G)**) | start, chat, agents, templates |
| `mission` | Mission Control | `overview` | overview, agents, approvals, chat, runs, sessions |

`classic` is not a layout. It is the shell's own frame, the one the app shell had before layouts.

A primary nav may name a page that is not there yet (`start`, `templates`, `artifacts`); the shell
keeps only the ids the manifest carries.

The browser frames are **(planned, F3 and wave 2)**. The server side below is shipped: the
manifest already lists the layouts, and a shell without the layout host ignores them.

## Configuration

<!-- This section is owned by the server track (F2). The browser sections (layout host, picker,
     registerLayout) are added below it by F3. -->

Layouts apply to `style: app` only. The standalone default (`dashboard`) is unchanged. A layout
chosen under another style is ignored, and the server logs one warning:
`layout ignored: style is 'dashboard'; use style: app`. Choosing a layout never changes the style.

### YAML

`layout:` is the existing `LayoutConfig`. Its chat position keys (`mode`, `width`, `height`) keep
working. The layout keys are added next to them:

```yaml
style: app
layout: command                  # shorthand for {default: command}
```

```yaml
style: app
layout:
  default: command               # the layout a viewer starts with; classic = the shell's own frame
  available: [command, chat-canvas, workbench]   # offered, in picker order (default: all)
  user_choice: true              # alias userChoice; a viewer's own pick may override default
  primary: [chat, runs, agents, jobs, config]     # primary nav for every layout (at most 7 shown)
  options:                       # per-layout settings, keyed by layout id
    mission: {dailyBudget: 10, environment: prod}
```

- A layout id is lower-case letters, digits and `-`, starts with a letter and has at most 40
  characters. `classic` is reserved: it is a valid `default`, never an `available` entry.
- `layout: classic` keeps an app that already used `style: app` on the frame it had before.
- A malformed entry never fails the config. The server ignores it with a warning, and
  `aiui validate` reports it as **5103** (for example `layout: Bad_Id`, or `available: command`
  where a list goes). The rest of the section still applies.

### Python

```python
import praisonaiui as aiui

aiui.set_style("app")
aiui.set_layout("command", available=["command", "chat-canvas"], user_choice=True)
aiui.set_layout(options={"mission": {"dailyBudget": 10}})   # only the arguments passed change
```

`set_layout(default=None, *, available=None, user_choice=None, primary=None, options=None)`
raises `ValueError` for a malformed id. Call it before the server starts.

### Environment

`AIUI_LAYOUT=<id>` or `AIUI_LAYOUT=classic` sets the default for one run. A malformed value is
ignored with a warning.

### Which layout a viewer gets

On the server, the default is the first of these that is set:

1. `AIUI_LAYOUT`
2. `aiui.set_layout()`
3. YAML `layout:`
4. the style default: `chat-canvas` for `style: app`

In the browser, a `?layout=<id>` preview for the tab wins, then the viewer's stored choice (only
when `user_choice` is true), then the server default, then classic **(planned, F3)**.

### Unknown ids

- An `available` id that no enabled plugin declares is dropped, with one warning.
- A `default` that is not available falls back to `chat-canvas` when it is offered, otherwise to
  the first available layout, with one warning. With nothing available, the shell uses classic.
- `aiui validate` warns with code **5101** for an id that is not a built-in layout (a plugin may
  still provide it; plugin layouts are only known once the server runs), **5102** for a layout
  chosen while the style is not `app`, and **5103** for a malformed entry.

### Switching a layout off

Each built-in layout is a first-party record, `builtin.layout-<id>`:

```yaml
extensions:
  disabled: [builtin.layout-mission]
```

A disabled layout leaves the picker and takes its own pages with it.

### Layout pages

A page can belong to a layout. Such a page is `shell_only`, so it is never in the page table,
`GET /api/pages` or the dashboard. It is in the app shell manifest only while a layout it names
is offered. Its manifest row carries `layouts` (and `replaces`, the page it stands in for while
that layout is active), and its `source` is the owning record, for example
`builtin.layout-guided`.

No built-in layout owns a page yet. Each one arrives with the frame that renders it **(planned)**:
Guided's `start` and `templates` (track G), Mission's `ops-overview`, which replaces `overview`
(track M), and `artifacts` (track D). Until then the layout records add no page to the manifest,
under any layout.

### Data that only some layouts need

A first-party record can declare `for_layouts=("command", "mission")`. It is mounted only while
one of those layouts is offered, or while `extensions.enabled` names it. Otherwise
`GET /api/plugins?origin=builtin` lists it as `disabled` with the reason `no layout needs it`, its
routes answer 404 and its feature module is never imported.

### Plugin layouts

A plugin declares its layouts with a `layouts()` hook, the same way first-party records do:

```python
from praisonaiui import LayoutSpec

class DeckPlugin:
    name = "deck"

    def static_dir(self):
        return Path(__file__).parent / "static"

    def layouts(self):
        return [LayoutSpec(id="deck", title="Deck", module="deck.js", home="chat",
                           primary=("chat", "logs"))]
```

- `module` is required. A relative path resolves into the plugin's static dir
  (`/_plugins/deck/deck.js`, with an SRI hash). That module calls `registerLayout("deck", …)`, and
  the shell imports it only while the layout is active **(planned, F3)**.
- An id that another plugin (or a built-in) already provides is ignored with a warning, and so is
  a `classic` or malformed id.
- On a remote or auth-enforced server, an entry-point plugin's layouts follow the same
  default-deny rule as its pages: list the plugin in `extensions.enabled`.
- Plugin pages may carry `layouts` and `replaces` too. `shell_only=True` keeps a `blocks` page
  out of `GET /api/pages`.

### The manifest

`GET /api/shell/manifest` has a top-level `layouts` key (`ShellLayouts` in
`src/frontend/src/sdk/manifest.ts`):

```json
{"default": "chat-canvas", "userChoice": true,
 "available": [{"id": "chat-canvas", "title": "Chat and Canvas", "description": "…", "order": 10,
                "home": "chat", "primary": ["chat", "artifacts", "…"], "source": "builtin"}]}
```

Outside `style: app` it is `{"default": "", "userChoice": true, "available": []}`, which the
shell reads as classic.
