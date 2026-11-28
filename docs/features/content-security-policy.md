# Content Security Policy

> A docs site built with aiui build ships with a strict Content-Security-Policy

A docs site built with `aiui build` ships with a strict Content-Security-Policy
and needs no configuration. The policy allows the scripts the site runs and
nothing else, so injected markup cannot run a script, and only your own site
can show the docs in a frame.

## What you get

`aiui build` works the policy out from what the site actually loads:

| Source | Directive |
|--------|-----------|
| The site's own files (app, chunks, fonts, `customCss`/`customJs` files, the `site.components` module and its import map's hash) | `'self'` |
| The small inline scripts the build writes (theme, URL, redirect stubs) | `script-src 'sha256-…'`, one hash each |
| The JSON the build inlines in each page (its Markdown, the navigation and route manifest) | nothing: `type="application/json"` is data the browser never runs |
| Google Fonts and font, stylesheet and script URLs in `site.theme.fonts`, `customCss`, `customJs` | `style-src`, `font-src`, `script-src` |
| [Integrations](https://ui.praison.ai/docs/features/analytics.md) (analytics, support chat) | each provider's hosts |
| YouTube, Vimeo and Loom embeds on a page | `frame-src` (the privacy-friendly player) |
| The `servers` of your OpenAPI specs (Try it) | `connect-src` |
| `assistant.endpoint`, `feedback.endpoint` on a static host | `connect-src` |
| A navbar `primary` button of `type: github` (the star count) | `connect-src https://api.github.com` |

Everything else stays strict: no `'unsafe-inline'` or `'unsafe-eval'` for
scripts, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
Images and media load from `'self'`, `data:`, `blob:` and any `https:` host,
so Markdown images and badges keep working. Styles allow `'unsafe-inline'`:
the app's code highlighting, diagrams and dialogs set inline styles.

The policy goes out three ways:

- **Every built page** carries it as `<meta http-equiv="Content-Security-Policy">`,
  right after `<meta charset>`. This works on any static host, GitHub Pages
  included.
- **`_headers`** in the build folder sends it as a header on Netlify and
  Cloudflare Pages, with `frame-ancestors 'self'` added (a meta tag cannot
  carry `frame-ancestors`).
- **`aiui serve` and `aiui dev`** send the `/*` headers of `_headers`, so the
  preview behaves like the host. The `aiui dev` reload script is a file
  (`/__aiui/dev.js`), so it runs under the same policy.

On another host (nginx, S3 with CloudFront, a CDN), copy the header line from
`_headers` into its configuration.

## Configure

```yaml
site:
  csp:
    connect-src: https://api.example.com     # add sources to a directive
    frame-ancestors: ["https://app.example.com"]
```

| `site.csp` | Effect |
|------------|--------|
| unset | On for a docs build (reported only when `integrations.gtm` is set, see below); off for other builds |
| `true` | On, enforced |
| `false` | Off: no meta tag, no `_headers` |
| `report-only` | Only `Content-Security-Policy-Report-Only` in `_headers` and from `aiui serve`: the browser logs what the policy would block, and blocks nothing |
| a map | On, with extra sources per directive (a string or a list). A list with `'none'` replaces the directive (`frame-ancestors: ["'none'"]` forbids every frame). `report-only: true` in the map reports instead of enforcing. `report-uri` sets where the browser posts reports |

Directive names are lower-case words (`script-src`, `connect-src`, ...) and
sources contain no spaces, `;` or `,`: anything else is a config error, so
the value is always a valid header.

## When to add sources

- **`customJs` that calls another server** (`fetch`, a WebSocket, a widget):
  add its origin under `connect-src`, `frame-src` or `script-src`.
- **Raw HTML in a page** needs no sources: the page renders YouTube, Vimeo
  and Loom `<iframe>` players, `<img>` and `<video>` (all allowed above), shows
  any other `<iframe>` as a link and removes `<script>`, `<form>` and similar
  elements before the policy is ever involved. `aiui validate` names each one
  (finding 7019; see [raw HTML](https://ui.praison.ai/docs/features/writing-docs.md#raw-html)). Inline event
  handlers (`onclick="…"`) never run.
- **Tag Manager (`integrations.gtm`)** runs whatever tags the container holds,
  which the build cannot see, so the default there is `report-only`. Add the
  hosts of your tags and set `site.csp: true` to enforce.
- **Legacy `site.plugins`**: `mermaid` and `syntax-highlight` load from their
  CDN, which the policy allows when they are listed. Other dashboard plugins
  are not meant for docs pages.

To find what a page needs, open the browser console: every blocked load or
script is logged with the directive that blocked it. `report-only` shows the
same messages without blocking anything.

## Related pages

- [Analytics, support chat and cookie consent](https://ui.praison.ai/docs/features/analytics.md)
- [Docs sign-in](https://ui.praison.ai/docs/features/docs-auth.md)
- [Hot Reload](https://ui.praison.ai/docs/features/hot-reload.md)
