# Layouts

A layout is the frame of the React app shell (`style: app`): the navigation,
the session list, the top bar, side panels and the phone chrome. The page
stays the page. Every page (chat, logs, config, a plugin page, a blocks page)
renders inside every layout, in the outlet the shell hands the frame. The
design is [ADR 0003](../adr/0003-selectable-layouts.md).

Layouts exist only in the app shell. The default `dashboard` style is not
affected and renders exactly as before.

## The layouts

| Id | Title | What it is for |
|---|---|---|
| `chat-canvas` | Chat + Canvas | Chat beside a canvas of the artifacts the agent makes. The app shell's default |
| `workbench` | Workbench | A quiet sidebar with your chats, and the page beside it |
| `command` | Command Deck | Keyboard first: a command bar, session tabs and a run inspector |
| `guided` | Guided | Plain language and large buttons; every step explained |
| `mission` | Mission Control | Agents, runs and approvals at a glance |
| `classic` | Classic | The core's own frame (the sidebar and header the app shell had before layouts). Always available, and the fallback |

Today the five built-in frames are placeholders on the shared layout kit
(`src/frontend/src/app-layouts/kit/`): a sidebar with the layout's primary
pages, the other pages under "More", the session list, and a phone menu
sheet. Each layout's own design (the canvas, the run inspector, the step
tracker, the mission board) is **(planned)** in its own track of the ADR.

Each built-in layout is its own lazy chunk (`layout-<id>`), with the kit in
`layout-kit`. The browser downloads only the chunks of the layout on screen;
an inactive layout costs nothing.

## Choosing a layout

**On the server** **(planned, ADR 0003 F2)**: the shell manifest's `layouts`
key lists the layouts the server offers (`available`), its `default` and
whether the viewer may choose (`userChoice`). It will be set by, highest
first: `AIUI_LAYOUT=<id>|classic`, `aiui.set_layout(...)`, YAML `layout:`
(`layout: command` or `layout: {default: command, available: [...],
user_choice: true, primary: [...]}`), then the style default (`chat-canvas`
for `style: app`). Until the server sends `layouts`, the shell renders the
classic frame, as before.

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

**The viewer** switches with the command palette ("Switch layout: Chat +
Canvas" and so on, group "Layout"; one command per offered layout and
Classic) or with **Settings → Appearance** (a select of the same list, shown
only when the server allows a user choice). The choice is saved in this
browser and applies at once, without a reload: the frame and the page
remount, and chat state is kept. When the server does not allow a choice,
the palette commands still switch, for this tab only. Saving the choice per
user across devices is **(planned)** (no server-side preference store yet).

## Writing a layout

A plugin adds a layout with the same SDK call the built-ins use,
`registerLayout(id, meta, Frame | loader)`. The Python declaration, the
browser module, the props a frame receives (`LayoutProps`: `Outlet`, `nav`,
`chrome`, `viewport`, `layout`) and a complete example are in
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
