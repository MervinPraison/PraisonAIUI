# React App Shell (`style: app`)

The app shell is a React interface for the PraisonAIUI dashboard: a sidebar,
a header with a command palette (⌘K / Ctrl+K), a React chat and a host that
runs every existing dashboard page inside it. It is **opt-in** in this
release. The default style is still `dashboard` (the vanilla-JS dashboard),
and it renders exactly as it did in v0.3.153.

## Turn it on

Any one of these:

| Where | How |
|---|---|
| YAML config | `style: app` |
| Python | `aiui.set_style("app")` before the server starts |
| CLI | `aiui run app.py --style app` |
| Environment | `AIUI_SHELL=app aiui run app.py` (alias: `AIUI_SHELL=react`) |

`AIUI_SHELL=app` only changes the `dashboard` style (explicit or default) into
`app`. Other styles (`chat`, `docs`, `agents`, `playground`, `custom`) are
never rewritten.

### Kill switch

`AIUI_SHELL=legacy` turns `app` back into `dashboard`, whatever the config
says. It is the documented way back once the default flips (see
[flip criteria](#when-the-default-flips)).

```bash
AIUI_SHELL=legacy aiui run app.py   # always the vanilla dashboard
```

## What you get

- **Every page you have today.** A page is resolved in this order:
    1. a React page registered through the SDK (built-in ports such as chat, or
       a [UI plugin](./plugins.md) page);
    2. a server-driven page (`register_page` with a handler, `@aiui.page`),
       rendered from its `_components` tree as blocks;
    3. otherwise the original dashboard view, mounted inside the shell.

  Nothing disappears: dashboard plugins (`kanban`, `sample-board`,
  `video-studio`), `set_custom_js` and `custom.js` `registerView` pages keep
  working as hosted pages.
- **React chat** over the WebSocket `/api/chat/ws` (streaming, tool calls,
  reasoning, inline approvals and questions, attachments, Stop, history).
  When the socket cannot open it falls back to Server-Sent Events (`POST /run`);
  on SSE an agent's question says that answering needs a live connection.
- **One markdown renderer** (Streamdown) for chat and docs, with lazy code
  highlighting (28 languages), Mermaid and KaTeX. In chat, external links open
  in a new tab with `rel="noopener noreferrer nofollow"`, and remote images
  are shown as a click-to-load placeholder naming their host (same-origin,
  `data:image/` and `blob:` images load directly).
- **Approval toasts.** A new approval anywhere raises a toast with a
  "Review" button that opens the Approvals page. On the chat page the
  approval is shown in the thread instead.

## Compatibility

| Existing API | `dashboard` (default) | `app` (opt-in) |
|---|---|---|
| `register_page` with a handler / `@aiui.page` | unchanged | server-driven blocks page |
| `register_page` without a handler | unchanged | hosted `custom.js` `registerView` page |
| `register_page_action` | unchanged | the page's action endpoint |
| `set_pages`, `pages.enabled/disabled` | unchanged | applied |
| `set_custom_js` | unchanged | injected; runs when the hosted runtime loads |
| `set_custom_css` | unchanged | unchanged; HSL triples warn (see below) |
| `set_theme`, `set_brand_color`, `register_theme` | unchanged | converted to theme seeds |
| dashboard plugins | unchanged | hosted pages; `dashboard.plugins` allowlist honoured |
| `chat`, `docs`, `agents`, `playground`, `custom` styles | same app, now lazy-loaded with the new markdown renderer and tokens | n/a |
| `aiui build` static docs | same app; `index.js`/`index.css` get a `?v=` content hash | n/a |

## Theme seeds (migration)

Colours now come from a small set of **seeds** (`--seed-accent`,
`--seed-ink`, `--seed-paper`, …). Everything else (`--background`,
`--primary`, sidebar and chart colours) is derived from them in CSS with
`color-mix()`, separately for light and dark. Python emits seeds only
(`praisonaiui.themes.get_seed_theme_css(preset, radius, accent, density)`):

- neutral presets (`zinc`, `slate`, `stone`, `gray`, `neutral`) are
  monochrome: the accent follows the ink;
- colour presets (`rose`, `blue`, …) seed the accent from the 600 shade in
  light mode, and the button text colour is picked automatically for
  at least 4.5:1 contrast;
- radius presets are unchanged.

`get_theme_css()` is kept for API compatibility but the compiler no longer
uses it. Runtime themes (`register_theme`, named presets) are converted to
seeds in the browser.

### Breaking change: bare HSL triples

Listed in the [changelog](../../CHANGELOG.md) for the release that ships the
app shell.

shadcn variables used to hold bare HSL triples that the stylesheet wrapped in
`hsl()`. They are now complete colours:

```css
/* before (no longer valid) */
:root { --primary: 221 83% 53%; }

/* after: any CSS colour */
:root { --primary: hsl(221 83% 53%); }

/* better: set the seed, and every derived colour follows in both modes */
:root { --seed-accent: hsl(221 83% 53%); }
```

`aiui validate` warns (code 5001) when `site.custom_css` sets one of these
variables to a bare triple. Custom CSS and runtime themes that still use
triples are converted in the browser where possible, but update the CSS.

## Caching and deploys

- Code chunks are content-hashed (`assets/<name>-<hash>.js`) and served with
  `Cache-Control: immutable`. `assets/index.js` and `assets/index.css` keep
  fixed names and are referenced as `?v=<hash>`, so a release never mixes an
  old entry with new chunks.
- `aiui build` writes `index.html` (and every route page) with
  `/assets/index.js?v=<sha256[:10]>` and the same for `index.css`, and copies
  `aiui-manifest.json` next to it.
- The docs deploy keeps the previous build's chunks for one release
  (`src/frontend/scripts/carry-forward-assets.mjs`), so a reader with an
  old page open can still load its lazy parts.
- A stale chunk that does fail to load triggers one automatic reload.

## Quality gates

| Gate | Command (in `src/frontend`) | Limit |
|---|---|---|
| Types | `npx tsc -b` | 0 errors |
| Unit tests | `npm test`, `npm run test:scripts` | all pass |
| Size (gzip) | `npm run size` | shell boot ≤ 150 kB, chat route ≤ 140 kB, /chat first-screen JS ≤ 250 kB, `index.css` ≤ 32 kB, Streamdown ≤ 147 kB (145 kB with `gzip -9`), shikiPlugin ≤ 55 kB, legacy App path ≤ 250 kB, all assets ≤ 9 MB uncompressed |
| First screen stays light | `npm run check:closure` | no Streamdown, Shiki, Mermaid, KaTeX or assistant-ui in the static closure of the entry, the shell or the legacy App |
| Committed bundle | `npm run check:bundle` | `templates/frontend` equals a fresh build (pull requests that touch the frontend only) |
| Browser suites | `npm run test:e2e` | see `src/frontend/e2e/README.md` |

The docs style preloads Streamdown before first paint (about 355 kB on that
path). This is an accepted exception until docs pages are pre-rendered at
build time.

## When the default flips

The default stays `dashboard` until **all** of these hold. Status as of this
release:

| # | Criterion | Status |
|---|---|---|
| 1 | Every page renders in the shell with status ready, 0 page errors and 0 leak delta in the Playwright sweep | **Not met.** Every manifest page is ready (a page that prints a JSON error body, or whose own data endpoint fails, now counts as an error; the Inspector was one and is fixed), 0 page errors, no page grows per visit, and every page opens by URL. Three pages keep a one-time residue after their first visit that does not grow, each listed with its reason in the sweep's `FIRST_VISIT_ALLOWANCE` (any other or larger residue fails): `chat` (13 window listeners and the composer's hidden measuring textarea), `chat-canvas` (one window listener) and `code-studio` (Monaco's interval, listener and two body nodes) |
| 2 | Chat parity complete | **Not met.** Done: streaming, tools, reasoning, approvals, ask, attachments, Stop, history, feedback, session rail, reconnect. Missing: message queue, channel messages with unread dots, context ring and compaction banner, cost chip, memory panel, floating and focus modes |
| 3 | Light mode correct on every page; owner signs off the light and dark screenshots | **Not met.** Awaiting owner review |
| 4 | Gates green: size, bundle-sync, entry closure, screenshots, pytest, tsc | **Partly.** All run green locally; screenshot comparison is not enforced in CI until Linux baselines exist |
| 5 | `set_custom_js`, `custom.js` `registerView` and the three bundled dashboard plugins work under `app` | **Met in this build.** The three dashboard plugins pass the sweep; the e2e app-shell server sets `set_custom_js` with a `registerView` for a page that also has a server handler, and the client view wins (as in the legacy dashboard) |
| 6 | One minor release with `app` opt-in, then two weeks with no open P1 from opt-in users | **Not met** |

## Plugins and trust

See [UI Plugins](./plugins.md). Installing a plugin package means trusting it:
its Python runs in the server process and its JavaScript runs in the page
with no sandbox. An `iframe` page is the sandboxed option.
