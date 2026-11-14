# Changelog

## Unreleased

### Breaking changes

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

- `style: app` (opt-in React shell); see
  [React app shell](docs/features/react-shell.md).
- App shell: built-in sidebar icons and group order come from the manifest
  (`navIcon` on each page, `layout.groups`); `set_dashboard(groups=...)` or
  YAML `dashboard.groups` overrides the group order and folding.
- `@aiui/sdk` exports `getPageId`, `usePageId`, `useThemeMode` and `dismiss`.
- The shell manifest reports `site.feedbackEnabled`, so the chat hides
  feedback buttons when feedback is switched off.
