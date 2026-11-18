# Changelog

## Unreleased

### Breaking changes

- **`aiui run app.py` opens the React app shell.** A plain chat app (a
  `@reply`, no `--style`, no `set_style()`, no YAML `style:`) now runs in
  `style: app` with the new `chat` layout: the Chat and Canvas frame without
  the canvas. `--style chat` (or `aiui.set_style("chat")`) keeps the classic
  chat. Apps that auto-detect as `agents` or `dashboard` are unchanged, and
  `create_app()` and PraisonAI keep Chat and Canvas as the app shell default.
  See [Layouts](docs/features/layouts.md).

- **Theme variables are complete colours, not bare HSL triples.** shadcn
  variables such as `--primary` used to hold `221 83% 53%`, which the
  stylesheet wrapped in `hsl()`. They now hold any CSS colour:
  `--primary: hsl(221 83% 53%)`, or better, set the seed
  (`--seed-accent: hsl(221 83% 53%)`) and every derived colour follows in both
  modes. `aiui validate` warns (code 5001) when `site.custom_css` sets one of
  these variables to a bare triple. See
  [React app shell → Breaking change](docs/features/react-shell.md#breaking-change-bare-hsl-triples).
- **Cross-origin access is opt-in.** The server no longer sends
  `Access-Control-Allow-Origin: *`, and it refuses cross-site WebSocket
  handshakes and cross-site `POST`/`PUT`/`PATCH`/`DELETE` requests. Set
  `AIUI_ALLOWED_ORIGINS` (comma-separated, or `*`) for a frontend served from
  another origin. See [Deployment → Cross-site requests](docs/features/deployment.md#cross-site-requests).
- **Local servers check the `Host` header.** A server reached on a loopback or
  private address answers only IP addresses, `localhost`, `*.local`, its own
  hostname and the names in `AIUI_ALLOWED_HOSTS` (DNS rebinding guard). A
  reverse proxy on the same machine that forwards a public host name to a
  loopback-bound server (nginx → `127.0.0.1:8082` with
  `proxy_set_header Host $host`) must now set `AIUI_ALLOWED_HOSTS` to that
  name. See [Deployment → Host names](docs/features/deployment.md#host-names-dns-rebinding).
- **Self-signup is off under `require_auth`.** `POST /register` needs a session
  unless `create_app(allow_signup=True)` or YAML `auth.allowSignup` is set.
- **App shell: full-bleed comes from `page.layout`.** The shell no longer keeps
  a list of page ids that fill the viewport. An app that registers its own
  `explorer` (or any) legacy page that needs the full viewport must pass
  `layout='full-bleed'`.
- **The frontend package is private.** `src/frontend/package.json` is no longer
  publishable and `build:lib` is removed; import UI components from the
  in-repo barrel `src/frontend/src/components/index.ts`, and write app-shell
  plugins against `@aiui/sdk`.

### Security

- `AUTH_ENFORCE=true` gates every route and every WebSocket, deny by default
  (it used to gate `/api/*` only, leaving `/sessions`, `/run`, `/v1/*`, `/agui`
  and others open).
- URL-token mode (`AIUI_REQUIRE_TOKEN`) and `require_auth=True` / YAML
  `auth.requireAuth` now gate WebSocket handshakes; `require_auth` no longer
  exempts every path.
- Under `require_auth=True` / YAML `auth.requireAuth`, `POST /register` is
  closed by default: it registers only the first user, or a signed-in user
  adding an account, unless YAML `auth.allowSignup: true` opens sign-up to
  anyone. It used to give any visitor a token that passed the auth check.
  See [Deployment → Self-registration](docs/features/deployment.md#self-registration-under-requireauth).
- WebSocket clients exchange the stored key for a single-use ticket
  (`POST /api/auth/ws-ticket`); `?token=` values are redacted from the logs.
- Only the connection that started a turn in a session may stop it or answer
  its prompts, over WebSocket and over `POST /api/chat/abort`.
- Plugin HTTP routes (`/api/plugins/<name>/*`) follow the same default-deny
  policy as plugin browser code for remote and auth-enforced servers.
- The dashboard's Knowledge, Guardrails, Traces, Security and Telemetry views
  escape the records they show (file names, guardrail descriptions, violation
  messages, span names, agent ids). Markup stored in those records used to run
  in the dashboard. The views' `esc()` helper now escapes quotes too, so it is
  safe inside attribute values.
- Inline JSON in HTML has one escaper, `praisonaiui.utils.json_for_html`, used
  by the app shell, the standalone replay page and built docs sites. The docs
  JSON-LD block, which used to inline page titles unescaped, now uses it too.
- `/dashboard-plugins/<name>/<path>` serves only files inside that plugin's
  folder. A `..` path could reach a sibling folder whose name started with the
  plugin's name.
- **Behaviour change:** the `/api/jobs` proxy no longer forwards aiui's own
  credentials (`Authorization`, cookies, `X-API-Key`, `?token=`) to the jobs
  server, and refuses paths with `.`/`..` segments (400), which could reach
  any path on the upstream host. A jobs server that needs a credential gets
  one from `set_jobs_proxy(url, token=...)`. See
  [PraisonAI package integration](docs/features/praisonai-package-integration.md).
- **Behaviour change:** Video Studio project ids must be one folder name,
  `projectPath` must lie inside the projects folder, and render `out` must be
  a plain file name, so requests cannot write outside the projects folder.
- **Behaviour change:** `POST /api/knowledge/add-file` reads only files in the
  chat attachments folder or a folder listed in `AIUI_KNOWLEDGE_ROOTS`; other
  paths get 400. It used to ingest any file the server could read.
- **Behaviour change:** request bodies are capped. A body over
  `AIUI_MAX_BODY_MB` (default 25 MiB; `0` turns it off) gets 413 before it is
  buffered, and the paths that need no credentials (`/api/auth/login`,
  `/login`, `/register`, `/api/protocol/negotiate`) take at most 64 KiB.
  Anyone could make the server hold an unbounded body in memory through the
  public login routes. Chat attachments over their 10 MB limit are refused
  before the file is read into memory, and a malformed login body gets 400
  instead of 500. See [Deployment → Environment Variables](docs/features/deployment.md#environment-variables).

### New

- **Docs sites load less JavaScript.** The chat, agents and playground
  layouts load only for their style, so a docs page's first load is 53.6 KB
  (gzip) smaller: 24 files instead of 33.
- **Docs sidebar icons and a phone breadcrumb.** A nav group's `icon:` (the
  navigation YAML already accepted it but nothing drew it) or a page's
  frontmatter `icon:` shows a line icon before its title; on phones the page
  head reads "Section › Page". ui.praison.ai gives its groups icons. See
  [Navigation → Sidebar Icons](docs/features/navigation.md#sidebar-icons).
- **Docs pages load their text with the page.** `aiui build` writes each
  page's Markdown into its HTML, so the first visit needs no request for it
  (the app reads it once and falls back to fetching).
- **Docs home hero preload.** `aiui build` writes `<link rel="preload" as="image">`
  for the home page's hero (one per colour mode, with a `prefers-color-scheme`
  media query), so the browser finds the image in the HTML instead of waiting
  for the app. See
  [Content sources → Home page](docs/features/content-sources.md).
- **Docs page actions and section links.** Above each docs page, "Copy page"
  copies its Markdown; the menu adds View as Markdown, Open in ChatGPT and
  Open in Claude. Section headings get a link icon that copies the section's
  URL. See [Writing docs pages → Page actions](docs/features/writing-docs.md#page-actions).
- **Docs search finds sections and text**, not only page titles. `aiui build`
  writes `search-index.json` (headings and text per page); the search dialog
  ranks titles, headings and text, shows "Section › Page" with the matched
  words and opens the page at the section. Links with a `#section` now open
  the page scrolled there. See
  [Writing docs pages → Search](docs/features/writing-docs.md#search).
- **Docs components**: `<Note>`, `<Info>`, `<Tip>`, `<Check>`, `<Warning>`,
  `<Danger>`, `<Steps>`/`<Step>`, `<CardGroup>`/`<Card>` (icon, link),
  `<Tabs>`/`<Tab>`, `<Accordion>`/`<AccordionGroup>` and `<Frame>` (caption),
  written as in Mintlify. Images in docs zoom on click. See
  [Writing docs pages](docs/features/writing-docs.md).
- **Docs code blocks: file names, highlighted lines, code groups.**
  ```` ```python title="app.py" {1,3-4} ```` (or `app.py {2}`, `hl_lines`,
  `highlight`) puts the file name in the block's header and tints the lines;
  `<CodeGroup>` shows several fences as tabs with one copy button. Comments
  in docs code now keep 4.5:1 contrast in light and dark. See
  [Writing docs pages → Code blocks](docs/features/writing-docs.md#code-blocks).
- **Docs page footer**: "Edit this page" (`content.docs.editLink.pattern`
  with `:path`), the date of the page's last commit
  (`content.docs.lastUpdated`, read from git by `aiui build`) and "Was this
  page helpful?" (`content.docs.feedback.issues`; a "No" opens a prefilled
  issue, nothing is stored). ui.praison.ai turns all three on. See
  [Writing docs pages → Page footer](docs/features/writing-docs.md#page-footer).
- **Theme preset `paper`** (the look of the Chat and Canvas screen) and
  `site.theme.mode: light | dark | system` for `aiui build`. A docs site with
  `preset: paper` draws in warm paper, a navy accent, Newsreader titles and
  Source Sans 3 text at 17px on 1.7, from its first paint; ui.praison.ai uses
  it and follows the reader's OS. New page:
  [Writing docs pages](docs/features/writing-docs.md). See
  [Theming → The Paper preset](docs/features/theming.md#the-paper-preset).
- **`aiui.yaml` is the default config file name.** `aiui init` writes
  `aiui.yaml`, and `aiui validate`, `build` and `serve` read it when no
  `--config` is given. `aiui.template.yaml` still works: when it is the only
  one there it is used, with a one-line hint on stderr to rename it; when both
  exist, `aiui.yaml` wins. `aiui dev` accepts either name in each example. See
  [Config file name](docs/concepts/configuration.md#config-file-name).
- App shell: a React Cron page inside the layouts: schedules in words and as
  cron, next and last run, an enabled switch, Run now, and a schedule builder.
- Docs sites: frontmatter `layout: home` on `docs/index.md` draws a hero
  (name, headline, tagline, call-to-action buttons, a light and a dark image)
  and a feature grid above the page, in the VitePress shape. See
  [Content sources → Home page layout](docs/features/content-sources.md#home-page-layout).

- Docs sites: `content.docs.nav.mode: manual` builds the sidebar from the YAML
  tab groups, in the listed order, with nested groups and a frontmatter
  `nav_title` for short sidebar titles; pages it does not list stay built and
  searchable. The default (`auto`, one section per folder) is unchanged. See
  [Navigation](docs/features/navigation.md#a-sidebar-you-list-mode-manual).

- `style: app` (opt-in React shell); see
  [React app shell](docs/features/react-shell.md).
- App shell: Knowledge is a React page inside a layout (ProList): a stat
  strip with the store's status in plain words, search with marked snippets
  and relevance, Add knowledge for text or files (drag and drop, per-file
  progress), a detail panel with Delete; the classic frame keeps the legacy
  view. See [Layouts](docs/features/layouts.md#react-pages-inside-every-layout).
- App shell: built-in sidebar icons and group order come from the manifest
  (`navIcon` on each page, `layout.groups`); `set_dashboard(groups=...)` or
  YAML `dashboard.groups` overrides the group order and folding.
- `@aiui/sdk` exports `getPageId`, `usePageId`, `useThemeMode` and `dismiss`.
- The shell manifest reports `site.feedbackEnabled`, so the chat hides
  feedback buttons when feedback is switched off.
- Docs sites (`style: docs`, `aiui build`) use the PraisonAI Pro design: the
  app shell's colours, type, radii and hairlines, a working search
  (⌘K / Ctrl+K), previous / next links, the YAML footer columns and a phone
  drawer with the section tabs. Frontmatter no longer shows as text, and
  relative links and images resolve against the page's folder.
- The Pro type is self-hosted: Geist and Geist Mono (SIL OFL 1.1, latin
  woff2, about 53 kB) ship in the wheel and load only on Pro pages (the
  layouts and the docs site). No font CDN.

### Fixed

- e2e: the page-types screenshot tests report **skipped** on a platform with
  no baseline (Linux CI today) after running their DOM checks, instead of
  passing without comparing anything. ARCHITECTURE §5 and the e2e README now
  list them with legacy-parity as not enforced on Linux yet.
- Package metadata no longer lists Python 3.9, which `requires-python
  >=3.10` already refused; ruff and mypy target 3.10 to match.
- Tests: CI runs all of `tests/integration` (the `aiui build` pipeline, the
  package smoke checklist, attachments, MCP connect security, the feature
  APIs), not 2 of its files, and e2e shard 1 runs the dashboard view
  resolution, host runtime, page reload and mkdocs preprocess suites, which
  always skipped in the python job. That step now fails when any of its tests
  skip (`pytest --fail-on-skip`). Integration tests no longer reach an LLM
  provider when your shell has API keys set. Six passing test files at the
  top of `tests/`, which CI never ran, moved into `tests/unit` and
  `tests/integration` (the gap features suite had four stale theme
  assertions, now written against the accent presets).
- Tests: the other 17 top-level test files are gone. Fifteen were scripts
  with no test functions (pytest collected nothing, or they crashed at
  import), one was a demo app, and the examples parity script needed a
  fixture that did not exist and timed out on its CLI checks. The feature
  APIs they poked are covered by `tests/integration/test_feature_apis.py` and
  the unit suites. `tests/unit/test_test_layout.py` keeps new test files out
  of the top level.
- Release: `pypi-release.yml` builds the commit the release gate checked
  (`trigger_sha`), not whatever `main` became while the run waited, and
  refuses unless that commit is still `origin/main` with a green CI run.
  It pushes the "Release vX.Y.Z" commit and tag before `uv publish`, never
  rebasing onto unchecked commits, so a rejected push publishes nothing. A
  dry run of the release no longer counts as "already released today", and
  the release gate fails (instead of skipping every night) when the next
  version is already on PyPI but `pyproject.toml` on `main` is behind.
- Docs: the plugin guide no longer tells you to pass `--style app` because a
  reply app "runs in the chat style" (`aiui run app.py` opens the app shell),
  says aiui ships six layouts, and ARCHITECTURE.md quotes the real SDK export
  (33) and catalog counts, now checked by `tests/unit/test_architecture_counts.py`.
- Dashboard Overview: Approve and Deny work. They post no body, and the
  server answered `Content-Length: 0` with a 500, so the tool stayed paused.
- API: malformed or empty JSON sent to a route that expects a body is a 400
  (`Request body is not valid JSON`), not a 500 with a traceback in the log.
- Chat: deleting a chat deletes its artifacts. They stayed in the Artifacts
  index and on disk.
- `aiui run chat.yaml`: the YAML's `datastore:` is used. It applied only
  when `--datastore memory` was also passed; a `--datastore` flag still wins.
- Chat (classic `chat` style): an inline image, PDF, video, file or A2UI
  surface that fails to render now shows "Failed to render element" in its
  place instead of taking the whole message down. The old `try`/`catch`
  around the element's JSX could not catch render errors; an error boundary
  does.
- CI lints the whole frontend (`npm run lint`), not only the core and engine
  folders: the app pages, layouts, layout features (R17) and the legacy React
  App are linted too. The 73 errors already there are fixed.
- Plugins: a plugin layout's module and stylesheet get the SRI check the docs
  promise. The module's `integrity` is now in the import map (it was left out,
  so a stale or half-written layout file loaded unchecked), and the css hash
  is kept (`LayoutSpec.css_integrity`, `cssIntegrity` on the wire) and set on
  the `<link>`.
- App shell: the default Chat and Canvas layout no longer downloads the Geist
  font (29.8 KB) it never shows. The server now writes the layout's Paper look
  on `<html>` with the Pro tokens, so the first paint already uses the Paper
  fonts and the text no longer changes font after it appears. Viewers who
  chose plain Pro, or another layout, still get it (an inline script drops the
  look before first paint). `LayoutSpec` gains an optional `look`.
- Plugins: an `extensions.enabled` allowlist no longer switches off a plugin
  the app passed to `aiui.register_plugin(obj)`. The allowlist picks which
  installed entry points to trust, as the docs say; only `extensions.disabled`
  turns your own plugin off.
- Plugins: a plugin's `features()` routes go when a later `create_app()` in the
  same process disables the plugin, and a built-in that is switched back on
  takes its feature name back from a plugin that borrowed it.
- Logs: Clear on the Logs page now sticks. `GET /api/logs` read a second
  buffer that `POST /api/logs/clear` never emptied, so the next poll brought
  every entry back and `/api/logs/stats` disagreed with it. One buffer and one
  handler remain, owned by `builtin.logs`: `GET /api/logs` is a `LogsFeature`
  route, each record is stored once, and with the built-in disabled
  `create_app` no longer imports `features/logs.py` or adds a root log handler.
  `server.api_logs` still imports and delegates to the feature.
- Channels: with the built-in in-process gateway (no `praisonai` wrapper
  installed), starting a channel bot no longer fails on the gateway path with
  `StandaloneGateway._create_bot() takes 4 positional arguments but 6 were
  given` and silently falls back to the direct import. The standalone gateway
  now takes the same `(platform, token, agent, bot_config, ch_cfg)` call as
  `WebSocketGateway`, so registered bot factories (`register_bot_factory`)
  build channel bots again.
- Serving speed. `aiui run app.py` (a chat app) no longer recopies the 11 MB
  bundle into `./aiui` on every start (setup 203 ms to 22 ms here); the
  package bundle was served anyway. Static files are gzipped once per file
  version off the event loop (a 796 kB chunk: 27 ms to 7 ms per request), and
  the page HTML, `/api/shell/manifest`, `/api/pages` and dashboard-plugin files
  are now compressed (the manifest 12.1 kB to 3.0 kB). Dashboard-plugin
  discovery stops reparsing every `manifest.json` per request. A site served by
  `aiui run --config` is compressed and sent `no-cache`, and its
  `/assets/theme.css` no longer 404s. `aiui serve` no longer answers
  `/docs/x` with a 307 to `/docs/x/`.
- Plugins: `aiui plugins doctor` now checks every `settings()`, `nav_groups()`,
  `themes()` and `layouts()` entry (and each layout's module and css file)
  and fails on any entry the server would drop. Before, a malformed section,
  group, theme or layout vanished from the UI while the doctor reported
  success.
- Plugins: a plugin page must be `kind` `react`, `blocks` or `iframe`.
  `legacy`, `native` or a typo used to pass the doctor and reach the manifest,
  then show "No handler for page" in the browser; it is now dropped with a
  warning and the doctor fails on it.
- Plugins: the warning for a dropped plugin entry is printed in the
  `aiui run` terminal on a plain install (it only reached the Logs page) and
  once per start, not again on every manifest request.
- Startup: `create_app()` no longer imports SQLAlchemy (the optional `sql`
  extra) unless `SQLAlchemyDataStore` is used, which saved about 90-350 ms per
  start where the extra is installed. A disabled `builtin.config` no longer
  loads the config watcher, and a config reload resets only registered
  features through a new optional `BaseFeatureProtocol.on_config_reload()`
  hook, so it never imports a disabled built-in. `builtin.video` loads the jobs
  store only when it renders, not at startup.
- Sessions: listing sessions no longer parses every session file on each call.
  The JSON and SDK file stores keep each session's row until its file
  changes (500 sessions of 40 messages, 29 MB: about 70-77 ms per list before,
  7-15 ms after the first), and the app shell lists them after every chat
  turn. `GET /api/sessions` and `GET /sessions` take optional
  `?limit=&offset=` and report `total`; the Overview counts sessions through
  a new `BaseDataStore.count_sessions()` instead of listing them.
- The default dashboard caches its page views. `dashboard.js` imported each
  view (`/plugins/views/<page>.js`) with `?v=<Date.now()>`, so every reload
  downloaded it again (32.7 KB for Chat). It now uses the build stamp, as the
  app shell already did: a repeat visit to `/chat` transfers 32.6 KB instead
  of 65.4 KB, and a new release still changes the URL.
- The default dashboard makes fewer requests on load. `/ui-config.json` was
  fetched 5 times and `/api/pages` twice; `dashboard.js` now asks once for
  each (the Chat view still reads the config once for its own mode). The Chat
  view loads highlight.js from the CDN only when a code block appears, not on
  every visit. A first visit to `/chat` drops from 35 requests and 202.7 KB to
  29 requests and 157.5 KB, with no third-party connection on an empty chat.
- Docs: a page no longer jumps as its code blocks first draw (Quick Start
  moved 0.037 CLS). Streamdown laid each code block out at a 200px placeholder
  (`content-visibility: auto`) for one frame before its real height; docs
  articles now lay them out normally.
- Docs: three generated mockup screenshots (an "AI Platform" upload dialog, a
  model-fallback editor and a "Nexus AI" agent tree) are gone from the
  Attachments, Model Fallback and Subagent Tree pages. They showed screens
  aiui does not have; the pages document the APIs, and Subagent Tree keeps its
  diagram.
- Docs sites (`aiui build`): a `README` or `index` page listed in a nav tab,
  or a page with a number prefix, now opens under that tab. The header used
  to fall back to the first tab for it (for example the ADP overview at
  `/docs/protocols/adp` showed under "Get started" instead of "Reference"),
  and the section eyebrow was missing.
- Docs home: the hero image no longer shifts the page as it loads (it keeps
  a 16:10 box until the file arrives), and only the image for the colour
  mode on screen downloads at first.
- Docs on phones: the folded "On this page" no longer appears a frame after
  the article and pushes it down (layout shift 0.070 → 0 on the home page,
  0.086 → 0.017 on Quick Start).
- Docs sites (`aiui build`): pages make far fewer requests, all to the site
  itself. The default `site.plugins` is now `fetch-retry` and
  `nav-intercept`: `mermaid`, `syntax-highlight`, `code-copy`, `toc`,
  `mkdocs-compat`, `content-loader`, `homepage` and `topnav` skip React docs
  pages, and two of them pulled about 40 files from cdnjs and jsdelivr on
  every page (plus a `languages/html.min.js` that does not exist). The plugin
  loader imports plugins as `?v=<hash of the plugin files>` instead of
  `?v=<Date.now()>`, so browsers and the CDN cache them. First page in a
  throttled probe (400 ms, 400 kbit/s): 96 requests from 3 origins (758 kB)
  down to 59 from 1 (515 kB). List a plugin under `site.plugins` to load it
  again. See [Deploy to GitHub Pages → Legacy plugins](docs/getting-started/github-pages.md#legacy-plugins).

- Docs sites: the home page has one URL, the site root. `/docs`, `/docs/`
  and `/docs/index` open it and move to `/`; sidebar, previous / next and
  `index.md` links point to `/`; the sitemap, `llms.txt`, `llms-full.txt`
  and canonical links name `/`. A URL with no page shows "Page not found"
  with links home and to search, instead of the developer view of the
  config (now only with `debug: true`).

- Docs sites: one slow connection no longer leaves a page on the loading
  skeleton for 20-30 seconds. Each request for a page's `.md` gets 5 seconds
  to answer, then a fresh request goes out (three attempts: 5 s, 5 s, 10 s).
  Pages are kept in memory and prefetched on hover, focus and press, and the
  previous / next pages while idle; the next click cancels the previous
  request; the renderer chunks hold up a fetched page for at most a second.
  When every attempt fails the page says "Couldn't load this page" with a
  Retry button. `fetch-retry.js` no longer retries `.md` (one retry layer) and
  never retries an aborted request. In a throttled probe a page whose request
  hangs for 30 s shows in 5.3 s instead of 31 s, and one whose new connection
  stalls for 18 s in 5.5 s instead of 18.5 s. See
  [Deploy to GitHub Pages → How pages load](docs/getting-started/github-pages.md#how-pages-load).

- Docs sites, first load: `ui-config.json`, `docs-nav.json` and
  `route-manifest.json` load with the same per-attempt time limit and retry
  as pages, a link straight to a docs page fetches its `.md` alongside them
  instead of a round trip later, and when they cannot load the page says
  "Couldn't load the docs" with a Retry button instead of staying blank.
  `fetch-retry.js` leaves any request with an abort signal to its caller.

- Docs sites (`aiui build`): the site root shows `docs/index.md` instead of an
  empty page; pages work on any static host (each page also has
  `docs/<page>/index.html`, and index pages and numbered files have their
  markdown at the URL the page loads, so `/docs/typescript` and ADR pages no
  longer say "not found"); a URL without the `/docs` base or naming a file
  (`/docs/adr/0001-x`) opens its page; digits inside a file name are no longer
  cut out of its URL. See
  [Content sources → Static hosting](docs/features/content-sources.md#static-hosting).

- Schedules: daily, weekly and custom cron schedules never ran unless
  `croniter` happened to be installed. It is now a core dependency (MIT), and
  `GET /api/schedules/{id}/stats` gives a cron job's `next_run_at`.
  `POST /api/schedules/{id}/stop` no longer fails with a `KeyError`.
- Knowledge no longer reports a working vector store when embeddings fail.
  praisonaiagents logs a failed embedding and carries on, so the status said
  `ok` with semantic search, added entries were marked synced while they lived
  only in memory (gone on restart), and search fell back to keyword matching
  as `vector`. The store now probes the embedding model when it starts and
  reads each write's result: status `degraded` with a plain reason, `persisted:
  false` and a `warning` on the add, `search_mode: fallback`. See
  [Knowledge embeddings](docs/features/knowledge-embeddings.md).
- Knowledge with a working vector store lists and searches what the store
  holds. `GET /api/knowledge` and `POST /api/knowledge/search` used to ignore
  the Chroma adapter's `SearchResult` and show only this run's in-memory
  copies, matched by keyword. A stored entry now takes the vector store's
  document ID, so list, search, `GET` and `DELETE` address one entry (#398).
- Schedules: `PUT /api/schedules/{id}` now changes `schedule` and `agent_name`,
  create keeps `agent_name`, and Run now records the run on the stored job.
- The `chat` style (the default of `aiui run`) and the other React styles
  follow the OS colour scheme, live, when neither the app (`set_theme`, YAML
  `site.theme`) nor the viewer chose a mode. They used to read only the
  filled-in `darkMode: true` and render dark on a light OS. See
  [Dark mode](docs/features/dark-mode.md#colour-mode-order).
- Chat: a failed `@reply` is no longer invisible. The run sent `run_error`
  and then `run_completed`, so the chat dropped the error, nothing was saved
  (a reload showed an unanswered question) and Mission Control counted the
  run as succeeded. A run now ends with exactly one terminal frame, a failed
  reply is saved with `status: "error"`, the run ledger keeps the first
  terminal status, the exception is logged with its traceback, and the
  dashboard chat closes its "Generating response…" bubble on an error or Stop.
- Chat: Stop cancels the `@reply` callback. The chat said "Stopped" while the
  callback kept running (and spending tokens) to the end.
- Chat: the `@reply` inactivity timeout is 600 s instead of 60 s, and
  configurable with `AIUI_REPLY_IDLE_TIMEOUT` (`0` turns it off). When it
  fires the callback is cancelled; its late answer used to be dropped while
  it kept running, and a `run_completed` followed the timeout error.
