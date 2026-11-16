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

### New

- App shell: a React Cron page inside the layouts: schedules in words and as
  cron, next and last run, an enabled switch, Run now, and a schedule builder.
- `style: app` (opt-in React shell); see
  [React app shell](docs/features/react-shell.md).
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
