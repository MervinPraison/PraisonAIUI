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
