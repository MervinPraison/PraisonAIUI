# Layouts

A layout is the frame of the React app shell (`style: app`): the navigation,
the session list, the top bar, side panels and the phone chrome. The page
stays the page. Every page (chat, logs, config, a plugin page, a blocks page)
renders inside every layout, in the outlet the shell hands the frame. The
design is [ADR 0003](../adr/0003-selectable-layouts.md).

Layouts exist only in the app shell. The default `dashboard` style is not
affected and renders exactly as before.

## The layouts

| Id | Title | What it is for | Opens on | Primary nav |
|---|---|---|---|---|
| `chat-canvas` (default) | Chat and Canvas | Chat beside a canvas of the artifacts the agent makes | `chat` | chat, artifacts, agents, cron, knowledge, sessions, config |
| `workbench` | Quiet Workbench | A quiet sidebar with your chats, and the page beside it | `chat` | chat, agents, knowledge, runs, config |
| `command` | Command Deck | Keyboard first: a command bar, session tabs and a run inspector | `chat` | chat, runs, agents, jobs, config |
| `guided` | Guided Studio | Plain language and large buttons; every step explained | `chat` (`start` **(planned, G)**) | start, chat, agents, templates |
| `mission` | Mission Control | Agents, runs and approvals at a glance | `overview` | overview, agents, approvals, chat, runs, sessions |

`classic` is not a layout. It is the core's own frame (the sidebar and header
the app shell had before layouts): always available, and the fallback.

A primary nav may name a page that is not there yet (`start`, `templates`);
the shell keeps only the ids the manifest carries.

Today the five built-in frames are placeholders on the shared layout kit
(`src/frontend/src/app-layouts/kit/`): a sidebar with the layout's primary
pages, the other pages under "More", the session list, and a phone menu
sheet. Each layout's own design (the canvas, the run inspector, the step
tracker, the mission board) is **(planned)** in its own track of the ADR.

Each built-in layout is its own lazy chunk (`layout-<id>`), with the kit in
`layout-kit`. The browser downloads only the chunks of the layout on screen;
an inactive layout costs nothing.

## Configuration

Layouts apply to `style: app` only. A layout chosen under another style is
ignored, and the server logs one warning:
`layout ignored: style is 'dashboard'; use style: app`. Choosing a layout
never changes the style.

### YAML

`layout:` is the existing `LayoutConfig`. Its chat position keys (`mode`,
`width`, `height`) keep working. The layout keys are added next to them:

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

- A layout id is lower-case letters, digits and `-`, starts with a letter and
  has at most 40 characters. `classic` is reserved: it is a valid `default`,
  never an `available` entry.
- `layout: classic` keeps an app that already used `style: app` on the frame
  it had before.
- A malformed entry never fails the config. The server ignores it with a
  warning, and `aiui validate` reports it as **5103** (for example
  `layout: Bad_Id`, or `available: command` where a list goes). The rest of
  the section still applies.

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

`AIUI_LAYOUT=<id>` or `AIUI_LAYOUT=classic` sets the default for one run. A
malformed value is ignored with a warning.

## Choosing a layout

**On the server**, the default is the first of these that is set:

1. `AIUI_LAYOUT`
2. `aiui.set_layout()`
3. YAML `layout:`
4. the style default: `chat-canvas` for `style: app`

The shell manifest's `layouts` key carries the layouts the server offers
(`available`), its `default` and whether the viewer may choose
(`userChoice`). A shell that receives no `layouts` key (an older server)
renders the classic frame.

**In the browser**, the shell renders the first of these that the server
offers:

1. A `?layout=<id>` preview. It is kept for the tab (sessionStorage
   `aiui-layout-preview`), so it survives navigation and reload, and it is
   never saved as the viewer's choice. `?layout=classic` previews the classic
   frame. Use it for screenshots and support links.
2. The viewer's own choice (localStorage `aiui-layout`), only when the server
   allows a user choice.
3. The server's default.
4. The classic frame.

A layout the server does not offer is never chosen, whatever is stored.

**The viewer** switches with the command palette ("Switch layout: …", group
"Layout"; one command per offered layout, named after its manifest title, and
Classic) or with **Settings → Appearance** (a select of the same list, shown
only when the server allows a user choice). The choice is saved in this
browser and applies at once, without a reload: the frame and the page
remount, and chat state is kept. When the server does not allow a choice,
the palette commands still switch, for this tab only. Saving the choice per
user across devices is **(planned)** (no server-side preference store yet).

### Unknown ids

- An `available` id that no enabled plugin declares is dropped, with one
  warning.
- A `default` that is not available falls back to `chat-canvas` when it is
  offered, otherwise to the first available layout, with one warning. With
  nothing available, the shell uses classic.
- `aiui validate` warns with code **5101** for an id that is not a built-in
  layout (a plugin may still provide it; plugin layouts are only known once
  the server runs), **5102** for a layout chosen while the style is not
  `app`, and **5103** for a malformed entry.

### Switching a layout off

Each built-in layout is a first-party record, `builtin.layout-<id>`:

```yaml
extensions:
  disabled: [builtin.layout-mission]
```

A disabled layout leaves the picker and takes its own pages with it.

## Layout pages

A page can belong to a layout. Such a page is `shell_only`, so it is never in
the page table, `GET /api/pages` or the dashboard. It is in the app shell
manifest only while a layout it names is offered. Its manifest row carries
`layouts` (and `replaces`, the page it stands in for while that layout is
active), and its `source` is the owning record, for example
`builtin.layout-guided`. The shell's nav shows such a page only while one of
its layouts is on screen; its URL renders under any layout.

Guided's `start` and `templates` (track G) and Mission's `ops-overview`, which
replaces `overview` (track M), arrive with the frames that render them
**(planned)**. Until then the layout records add no page to the manifest.

The one layout page shipped today is `artifacts` (`layouts: [chat-canvas]`),
owned by the data record `builtin.artifacts` rather than a layout record: the
index of every chat's artifacts, where the canvas's Share links land. See
[Layout data](layout-data.md).

## Data that only some layouts need

A first-party record can declare `for_layouts=("command", "mission")`. It is
mounted only while one of those layouts is offered, or while
`extensions.enabled` names it. Otherwise `GET /api/plugins?origin=builtin`
lists it as `disabled` with the reason `no layout needs it`, its routes answer
404 and its feature module is never imported.

## Follow-up suggestions

A reply handler can offer follow-up prompts for the answer it is writing.
They go out on the run's `run_completed` frame as `suggestions` (an optional
field; clients that do not know it ignore it), and a layout that shows
follow-up chips renders them **(planned: the Guided frame, track G)**:

```python
import praisonaiui as aiui

@aiui.reply
async def on_message(message):
    await aiui.say("Here is the comparison.")
    aiui.suggest(["Show me a benchmark", "Explain timsort"])
```

A later call replaces the list and `aiui.suggest([])` clears it. Blank
entries are dropped, each prompt is cut to 200 characters and at most 8 are
kept. Outside a chat run the call does nothing.

## Plugin layouts

A plugin adds a layout with the same SDK call the built-ins use,
`registerLayout(id, meta, Frame | loader)`. Its Python side declares it with a
`layouts()` hook, the same way first-party records do:

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
  (`/_plugins/deck/deck.js`, with an SRI hash). That module calls
  `registerLayout("deck", …)`, and the shell imports it only while the layout
  is active.
- An id that another plugin (or a built-in) already provides is ignored with
  a warning, and so is a `classic` or malformed id.
- On a remote or auth-enforced server, an entry-point plugin's layouts follow
  the same default-deny rule as its pages: list the plugin in
  `extensions.enabled`.
- Plugin pages may carry `layouts` and `replaces` too. `shell_only=True`
  keeps a `blocks` page out of `GET /api/pages`.

The browser module, the props a frame receives (`LayoutProps`: `Outlet`,
`nav`, `chrome`, `viewport`, `layout`) and a complete example are in
[UI Plugins → Layouts](./plugins.md#layouts). The fixture
`src/frontend/e2e/fixtures/layout-plugin/` is a working third-party layout
plugin.

In short, a frame:

- renders `<Outlet />` once, inside a `main` with `id={chrome.mainId}`;
- draws its navigation from `nav` (`primary` at most 7 items, `groups` for the
  rest, `footer`) and navigates with `nav.go(pageId)`;
- uses `chrome.openPalette()` for search and commands (there is one palette),
  and `chrome.Slot` for the shell's slots (`header:actions`, …);
- draws its phone frame when `viewport === 'phone'` (below 768 px), with touch
  targets of at least 44 px;
- reads data such as the session list with `useLayoutData('sessions')`, and
  renders without it when that returns null.

## When a layout fails

A layout whose module fails to import, or whose frame throws while
rendering, is replaced by the classic frame. The viewer sees one toast ("The
"…" layout failed to load"), and the shell fires one `aiui:plugin-error`
window event whose `detail.layout` is the layout id. Other layouts and the
pages are not affected. While a plugin layout is still loading, the shell
shows a frame skeleton; a selected layout that no plugin ever registers falls
back to the classic frame with a console warning.

## Isolation and budgets

These rules keep layouts independent (ARCHITECTURE.md R17):

- every layout lives in `src/frontend/src/app-layouts/<id>/` and is built as
  the chunk `layout-<id>`; shared pieces live in `app-layouts/kit/`
  (`layout-kit`), never copied; layout-specific features live in
  `src/frontend/src/layout-features/<name>/` (`lf-<name>`) **(planned: none
  exist yet)**;
- a layout never imports another layout or the shell, and loads a feature only
  with `import()`;
- the core (`shell/`, `sdk/`, `legacy/`, `blocks/`) names no layout id and
  imports neither folder (`shell/core-purity.test.ts`);
- the boot path loads no layout chunk, and a layout's closure contains no other
  layout, no feature, and no Streamdown, Shiki, Mermaid, KaTeX or
  `@assistant-ui` (`scripts/check-layout-isolation.mjs`, part of
  `npm run check:closure`); in the browser,
  `e2e/specs/layouts-host.spec.ts` checks that each layout downloads only its
  own chunks and the kit.

Each layout, the kit and the `/chat` first screen with the default layout
have gzip budgets in `src/frontend/.size-limit.mjs` (listed in
ARCHITECTURE.md R10). `npm run size` fails when a budgeted layout or the kit
is missing from the build.

## The manifest

`GET /api/shell/manifest` has a top-level `layouts` key (`ShellLayouts` in
`src/frontend/src/sdk/manifest.ts`):

```json
{"default": "chat-canvas", "userChoice": true,
 "available": [{"id": "chat-canvas", "title": "Chat and Canvas", "description": "…", "order": 10,
                "home": "chat", "primary": ["chat", "artifacts", "…"], "source": "builtin"}]}
```

Outside `style: app` it is `{"default": "", "userChoice": true, "available": []}`, which the
shell reads as classic.
