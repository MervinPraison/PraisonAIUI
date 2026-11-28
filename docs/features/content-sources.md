# Content Sources

> content.docs tells aiui build where your Markdown lives. Each file becomes a

`content.docs` tells `aiui build` where your Markdown lives. Each file becomes a
page under `site.routeBaseDocs` (default `/docs`).

## Docs Directory

```yaml
content:
  docs:
    dir: "./docs"
```

The path is relative to the config file.

## Include/Exclude Patterns

```yaml
content:
  docs:
    dir: "./docs"
    include:            # default: ["**/*.md", "**/*.mdx"]
      - "**/*.md"
    exclude:
      - "drafts/**"
      - "_*.md"
```

`include` patterns are globs relative to `dir`. An `exclude` pattern matches
the path relative to `dir`, a folder holding it (`drafts`, `drafts/`) or, with
no `/`, any file or folder name (`*.tmp`). A leading `/` anchors it to `dir`;
`!pattern` brings back a file an earlier pattern left out.

Excluded files are not published at all: `aiui build` copies neither the
pages nor the images next to them, and it lists what it left out.

The same patterns can live in an `.aiuiignore` file next to `aiui.yaml`, one
per line (`#` starts a comment); they add to `exclude`:

```text
# .aiuiignore
drafts/
internal/
*.secret.md
```

## Index Files

`index.md` and `README.md` (any case) are the page of their folder:
`guides/index.md` is served at `/docs/guides`. `indexFiles` is accepted in the
config, but other file names are not treated as index pages yet.

## Frontmatter

```markdown
---
title: "Custom Title"
order: 1
description: "One sentence for search results."
---

# Page Content
```

| Field | Description |
|-------|-------------|
| `title` | Page title in the navigation; default: the first `#` heading, then the slug |
| `order` | Sort order within the folder (lower first); `0` or missing falls back to a number prefix |
| `description` | Meta description; default: the first paragraph of 20 or more characters, cut at 160 |
| `noindex` | `true` adds `robots: noindex, nofollow` and leaves the page out of the sitemap |
| `layout` | `home` on `docs/index.md` draws the [home page layout](#home-page-layout) |

The frontmatter block is not shown on the page.

## Home Page Layout

Frontmatter `layout: home` on the docs home page (`docs/index.md`) puts a
hero and a feature grid above the page's own Markdown, the way VitePress does:

```markdown
---
title: Acme
layout: home
hero:
  name: Acme                          # the page heading, in the accent colour
  text: Ship your agent's UI today    # the large headline
  tagline: One sentence that says what it is and who it is for.
  image: images/app-light.webp        # optional, relative to this page
  imageDark: images/app-dark.webp     # optional, shown in dark mode instead
  imageAlt: The app with a conversation open
  actions:
    - text: Quick start
      link: getting-started/quickstart.md
    - text: GitHub
      link: https://github.com/acme/acme
      theme: alt                      # brand (default) or alt
features:
  - title: Chat
    icon: message-square
    details: Streaming replies, tool calls and approvals.
    link: guides/chat.md
    linkText: Chat guide
---

## Install

The Markdown below the frontmatter renders under the hero.
```

- The hero image keeps a 16:10 box until the file arrives, so nothing below it
  jumps as it loads; once loaded it takes the image's own shape. Screenshots
  at 16:10 (1600 × 1000, say) never move the page. Only the image for the
  colour mode on screen downloads at first; the other one waits until the
  reader switches.
- `aiui build` adds `<link rel="preload" as="image">` for the hero to the home
  page's HTML, so the download starts with the page instead of after the app
  has drawn the hero. With `site.theme.mode: system` (or no mode) each image
  gets the matching `prefers-color-scheme` media query; a fixed `light` or
  `dark` preloads only that image. A reader whose saved light/dark choice
  differs from the system setting downloads both.

- Links and images resolve against the home page like Markdown links, and
  links to other sites open in a new tab.
- `icon` is one of `message-square`, `panels-top-left`, `layout-dashboard`,
  `book-open`, `plug`, `shield-check`, `code`, `terminal`, `bot`, `zap`,
  `rocket` and `palette` (lucide line icons); any other name shows no icon.
- Up to 4 actions and 12 features are kept. Every value is plain text.
- Only the docs home page reads `layout: home`; on other pages it does nothing.

## Numbered Prefixes

```
docs/
├── 01-introduction.md   # order 1, served at /docs/introduction
├── 02-installation.md   # order 2
└── 03-quickstart.md     # order 3
```

A leading number gives the order when the frontmatter sets none, and the
`NN-` prefix is stripped from the URL. Only a prefix at the start of a folder or
file name counts: digits inside a name stay (`ui-reset-2026-11.md` is served at
`/docs/ui-reset-2026-11`). A link that names the file (`01-introduction.md`)
opens the page at its URL.

## Static Hosting

`aiui build` writes a site any static host can serve, with no rewrite rules:

| File | Why |
|------|-----|
| `index.html` | The site root; it shows `docs/index.md` (the docs home page). `/docs` and `/docs/index` open the same page and move to `/`, the home page's one URL (also in the sitemap, `llms.txt` and canonical links) |
| `docs/<page>.html` | `/docs/<page>` on hosts that map a path to `<path>.html` (GitHub Pages, Netlify, Cloudflare Pages) |
| `docs/<page>/index.html` | `/docs/<page>/` on hosts that do not (S3, `python -m http.server`); the page drops the trailing slash |
| `docs/<page>.md` | The markdown the page loads, also for index pages (`guides/index.md` → `docs/guides.md`) and numbered files |
| `404.html` | Any other path loads the site, which opens the page the URL means (`/guides/setup` opens `/docs/guides/setup`) or shows "Page not found" with links home and to search |

## Related

- [Navigation](https://ui.praison.ai/docs/features/navigation.md): how pages become the sidebar
- [SEO](https://ui.praison.ai/docs/features/seo.md): meta tags, sitemap and `robots.txt`

## Related pages

- [Navigation](https://ui.praison.ai/docs/features/navigation.md)
- [Deployment Guide](https://ui.praison.ai/docs/features/deployment.md)
- [Media, Markdown & Content Components](https://ui.praison.ai/docs/components/media-and-content.md)
