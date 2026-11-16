# Content Sources

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
either the path relative to `dir` or the bare file name.

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

The frontmatter block is not shown on the page.

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
| `index.html` | The site root; it shows `docs/index.md` (the docs home page) |
| `docs/<page>.html` | `/docs/<page>` on hosts that map a path to `<path>.html` (GitHub Pages, Netlify, Cloudflare Pages) |
| `docs/<page>/index.html` | `/docs/<page>/` on hosts that do not (S3, `python -m http.server`); the page drops the trailing slash |
| `docs/<page>.md` | The markdown the page loads, also for index pages (`guides/index.md` → `docs/guides.md`) and numbered files |
| `404.html` | Any other path loads the site, which opens the page the URL means: `/guides/setup` opens `/docs/guides/setup` |

## Related

- [Navigation](navigation.md): how pages become the sidebar
- [SEO](seo.md): meta tags, sitemap and `robots.txt`
