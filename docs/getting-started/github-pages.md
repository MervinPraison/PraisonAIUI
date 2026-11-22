# Deploy to GitHub Pages

Ship your AIUI docs site to GitHub Pages with one workflow file.

## Quick Start

### 1. Project Structure

```
my-project/
├── aiui.yaml    # Site configuration
├── docs/                 # Your markdown content
│   ├── index.md
│   └── guide.md
├── CNAME                 # Custom domain (optional)
└── .github/
    └── workflows/
        └── deploy.yml    # GitHub Actions workflow
```

### 2. Configuration

Create `aiui.yaml`:

```yaml
schemaVersion: 1

site:
  title: "My Docs"
  description: "Documentation for my project"
  ui: "shadcn"
  theme:
    preset: "zinc"
    darkMode: true

content:
  docs:
    dir: "./docs"
    include:
      - "**/*.md"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "header_main" }
      left: { ref: "sidebar_docs" }
      main: { type: "DocContent" }
      footer: { ref: "footer_main" }

components:
  header_main:
    type: "Header"
    props:
      logoText: "My Docs"
  footer_main:
    type: "Footer"
    props:
      text: "© 2026"
  sidebar_docs:
    type: "DocsSidebar"
    props:
      source: "docs-nav"

routes:
  - match: "/docs/**"
    template: "docs"
```

### 3. GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy Docs

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    permissions:
      contents: write
      pages: write
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install AIUI
        run: pip install aiui

      - name: Build
        run: |
          # auto: user.github.io/<repo> gets the /<repo> prefix; a CNAME or a
          # <user>.github.io repo is served at the root
          aiui build --output site --minify --base-path auto
          # Keep the custom domain, if there is one
          if [ -f CNAME ]; then cp CNAME site/CNAME; fi

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./site
```

### 4. Enable GitHub Pages

1. Go to **Settings → Pages** in your GitHub repo
2. Set **Source** to `Deploy from a branch`
3. Set **Branch** to `gh-pages` / `/ (root)`
4. Push to `main` — your site deploys automatically

## Project sites (no custom domain)

A repository other than `<user>.github.io` is published at
`https://<user>.github.io/<repo>/`, under a path prefix. `--base-path auto` in
the workflow above handles it: in GitHub Actions it reads the repository name,
so every asset, page, link, search and Markdown URL starts with `/<repo>`, and
the sitemap, `llms.txt` and canonical links use
`https://<user>.github.io/<repo>` as the site URL. Nothing else to configure,
and no custom domain needed.

`auto` builds for the root when the repository has a `CNAME` file, when the
repository is `<user>.github.io`, when `seo.siteUrl` is set (its path is the
prefix), and outside GitHub Actions. To set the prefix yourself:

```yaml
site:
  basePath: /my-repo        # or: aiui build --base-path /my-repo
```

The same works for any host that serves the site under a path, such as
`example.com/docs` behind a reverse proxy (`--base-path /docs`). Write links in
your Markdown as usual (`/docs/guide`, `../img/x.png`): the build and the app
add the prefix. Order of precedence: `--base-path`, then `site.basePath`, then
the path of `seo.siteUrl`. `--base-path /` builds for the root.

If you deploy with `actions/configure-pages` (Pages source "GitHub Actions"),
you can pass its output instead, which also knows a custom domain set in the
repository settings: `--base-path "${{ steps.pages.outputs.base_path }}"`.

Preview a prefixed build locally: `aiui serve --base-path /my-repo` serves it at
`http://127.0.0.1:8000/my-repo/` (and `aiui serve --no-build` serves an
existing build under the prefix it was built for).

Under a prefix, the legacy plugins that read the URL themselves
(`content-loader`, `homepage`, `topnav`) are not supported; the default
`nav-intercept` and `fetch-retry` are.

## Custom Domain

To use a custom domain (e.g., `docs.example.com`):

1. Create a `CNAME` file in your repo root:
   ```
   docs.example.com
   ```
2. Configure DNS — add a CNAME record pointing to `<username>.github.io`
3. The workflow above copies `CNAME` into the build output. The build also
   uses it as the site URL for the sitemap and canonical links.

## Migrating from MkDocs

| MkDocs | AIUI |
|--------|------|
| `mkdocs.yml` | `aiui.yaml` |
| `mkdocs build` → `./site/` | `aiui build --output site` → `./site/` |
| `mkdocs serve` | `aiui dev` |
| `pip install mkdocs-material` | `pip install aiui` |

What carries over from Material for MkDocs pages:

- Admonitions (`!!! note "Title"`, collapsible `???`), content tabs
  (`=== "Tab"` with 4-space indented content) and fenced code blocks render.
- `attr_list` (`{ .class }`) is not supported and shows as literal text;
  `:material-*:` icon shortcodes do not render as icons; raw HTML blocks are not
  styled. Remove them.
- The `nav:` list in `mkdocs.yml` is not read. Pages are ordered by the
  frontmatter `order` value, then a number prefix in the file name
  (`01-intro.md`), then the file name. See [Navigation](../features/navigation.md).

### Migration steps

1. Create `aiui.yaml` (see the example above) and run
   `aiui validate --strict`.
2. Replace `mkdocs build` with `aiui build --output site --minify` in your CI workflow.
3. Check the pages for the unsupported syntax listed above.
4. Push to `main`.

## Local preview

```bash
aiui dev     # build, serve on http://127.0.0.1:8000, reload the browser on save
```

See [Hot Reload](../features/hot-reload.md).

## Build output

`aiui build --output site` produces:

```
site/
├── index.html           # single-page app entry
├── 404.html             # copy of index.html, so GitHub Pages serves deep links
├── .nojekyll            # tells GitHub Pages not to run Jekyll
├── assets/              # JS and CSS bundles
├── aiui-manifest.json   # list of hashed bundle chunks
├── ui-config.json       # site configuration manifest
├── docs-nav.json        # navigation tree
├── route-manifest.json  # route definitions
├── robots.txt
├── plugins/             # plugin-loader.js, plugins.json and the enabled legacy plugins
└── docs/
    ├── index.html       # one pre-rendered page per document (title, description)
    ├── index.md         # the Markdown source, loaded by the app
    └── ...
```

With a site URL (`seo.siteUrl`, or the `CNAME` file) the build also writes
`sitemap.xml`, `llms.txt` and `llms-full.txt`; see [SEO](../features/seo.md).

Everything is static, so GitHub Pages serves it directly.

## How pages load

Opening a page from the sidebar fetches its `.md` file. A reader on a lossy
network (Wi-Fi, VPN, a mobile link) sometimes gets one new connection that
hangs for 15 to 30 seconds while every other request is fast. The docs app
keeps one such request from freezing the page:

- **Time limit and retry.** Each request for a page has 3 seconds to get an
  answer from the server. Past that it is cancelled and a fresh request goes
  out, which opens a new connection. There are three attempts (3 s, 5 s, then
  8 s for a link that is only slow), with a short random pause between them.
  A network error or a 5xx answer is retried the same way; a 404 is not. From
  the second attempt the loading skeleton says "Taking longer than usual.
  Trying again (2 of 3)", so a slow page is never a silent skeleton.
- **Stalled downloads.** Once the answer starts, a page whose download sends
  nothing for 4 seconds has stalled and is requested again; one that keeps
  arriving, however slowly, gets up to 15 seconds.
- **No queueing behind another tab.** A browser lets one request per URL at a
  time fill its HTTP cache entry; a second request for the same file (from
  another tab, say) waits inside the browser until the first one is answered.
  Page Markdown, and every retry, is requested with `cache: 'no-store'`, so a
  stuck request elsewhere can never hold this page. The CDN still caches, and
  the app keeps pages it has loaded in memory.
- **`aiui:docs-load` records.** Every attempt's outcome is pushed to
  `window.__aiuiDocsLoad` (newest 200), sent as a `window` event
  `aiui:docs-load` and logged to the console (`console.warn` for retries and
  failures). A record is `{v: 1, type: 'aiui:docs-load', url, kind: 'doc' |
  'manifest', attempt, of, ms, outcome, reason?, status?, detail?, at}`, where
  `outcome` is `ok`, `retry`, `failed`, `inline`, `inline-mismatch` or
  `duplicate`, and `reason` is `headers-timeout`, `body-idle`, `body-timeout`,
  `network-error` or `http-5xx`.
- **Prefetch.** Resting the pointer on a sidebar, previous / next or
  in-article docs link for 80 ms, focusing it with the keyboard, or pressing
  it starts loading that page. Once a page has shown, its previous and next
  pages load while the browser is idle.
- **In-memory cache.** A page loaded or prefetched once shows at once when you
  come back to it, without a request, until the tab is reloaded.
- **The last click wins.** Clicking another link cancels the request for the
  page you left, so fast clicking never builds a queue.
- **No long wait for the renderer.** A fetched page waits at most one second
  for the code highlighter and math renderer; after that the text shows and
  upgrades when they arrive.
- **Retry state.** When every attempt fails, the page says "Couldn't load this
  page" with a **Retry** button instead of a loading skeleton.
- **First load.** Every page `aiui build` writes carries the navigation
  (`docs-nav.json`), the route manifest and the page's own Markdown, so a first
  visit or a reload asks for none of them (`aiui build --strict` fails if a
  page's inlined Markdown is keyed by another URL than the app requests); `ui-config.json` is preloaded with the page (a
  live `aiui serve` adds Ask AI, MCP and feedback to it, so it is not baked in).
  The loader's tag names the plugins, so `plugins/plugins.json` is not
  requested either: on this site a first docs page went from five JSON requests
  and three plugin scripts to one and two. A file the page does not carry (a
  navigation over 100 KB, the navigation of a site with
  [sign-in](../features/docs-auth.md), a page served without its content)
  loads with the same time limit and retries as a page. If it cannot load, the
  page says "Couldn't load the docs" with a **Retry** button instead of
  staying blank.

This site, https://ui.praison.ai, is built the same way: see
[`.github/workflows/deploy-pages.yml`](https://github.com/MervinPraison/PraisonAIUI/blob/main/.github/workflows/deploy-pages.yml).

## Legacy plugins

The docs app renders code (Shiki), mermaid diagrams, MkDocs tabs and
admonitions, "On this page" and the header tabs itself. By default a build
loads only one of the vanilla plugins in `plugins/`:

| Plugin | Why it loads |
|---|---|
| `nav-intercept` | Keeps in-article `/docs` links on in-app navigation (no full page load) |

`fetch-retry` (retry a failed request for the site manifests) is no longer in
the default list: the app reads the navigation and route manifest from the
page and fetches `ui-config.json` with its own time limit and retries, which
`fetch-retry` leaves alone. List it under `site.plugins` to keep it.

`mermaid`, `syntax-highlight`, `code-copy`, `toc`, `mkdocs-compat`,
`content-loader`, `homepage` and `topnav` no longer load by default: they skip
React docs pages, and `mermaid` and `syntax-highlight` fetched about 40 files
from cdn.jsdelivr.net and cdnjs.cloudflare.com on every page (each new origin
is another connection that can stall). A site can still list any of them under
`site.plugins` in `aiui.yaml`.

`index.html` loads `plugins/plugin-loader.js?v=<version>`, where the version
is a hash of the plugin files in the build (also in `plugins/plugins.json`),
and names the plugins on the same tag (`data-plugins`), so the loader does not
fetch `plugins.json` (a server's pages, which lack it, still do).
The loader imports every plugin with the same `?v=`, so browsers and the CDN
cache them until a build changes a plugin.
