# SEO

Built-in SEO for documentation sites — sitemap, robots, llms.txt, per-page meta tags, and crawlable static HTML.

## Configuration

Top-level `seo` block in `aiui.yaml`:

```yaml
seo:
  siteUrl: "https://ui.praison.ai"
  titleTemplate: "%s | %s"
  defaultImage: "/icon.svg"
  robots:
    index: true          # false: the whole site is noindex (see below)
    follow: true
  indexing: navigable    # or `all`: index hidden pages too
  trailingSlash: false   # true: canonical, og:url, sitemap and llms URLs end in /
  contentSignals:        # optional robots.txt Content-Signal line
    search: true
    aiInput: true
    aiTrain: false
  twitter:
    handle: "@yourhandle"
```

Every key is optional; the defaults are what most sites want.

`siteUrl` is needed for absolute canonical URLs and `sitemap.xml`. Without it
the build falls back to a `CNAME` file next to the config (or in `docs/`), and
without either there is no sitemap and `llms.txt` / `llms-full.txt` use
root-relative links. What the build publishes for agents (agent-ready `.md`
pages, `llms.txt` by nav group, `markdown.instructions`):
[AI-ready docs](ai-ready-docs.md).

## Build outputs

`aiui build` automatically generates:

| File | Purpose |
|------|---------|
| `sitemap.xml` | All doc URLs with `lastmod` dates |
| `robots.txt` | Crawl rules + sitemap pointer |
| `llms.txt` | AI crawler index ([llmstxt.org](https://llmstxt.org)), one section per nav group |
| `llms-full.txt` | Every page as agent-ready Markdown, in one file |
| `docs/**/*.html` | Per-route HTML with meta tags + crawl nav |
| `.nojekyll` | GitHub Pages Jekyll bypass |

No extra flags are needed: the files are written whenever `content.docs` is
configured (the site-URL ones only when a site URL is known, see above).

A `robots.txt` or `sitemap.xml` next to `aiui.yaml` is published as it is,
instead of the generated one.

## Who gets indexed

One rule decides the sitemap, `llms.txt`, `llms-full.txt`, site search and
the page's robots meta, so they never disagree:

| Page | Sidebar | Sitemap, llms, search | `<meta name="robots">` |
|------|---------|-----------------------|------------------------|
| normal | yes | yes | `index, follow` |
| `noindex: true` | yes | no | `noindex` |
| hidden | no | no (yes with `seo.indexing: all`) | `noindex` (`index, follow` with `all`) |
| any, with `seo.robots.index: false` | as above | no sitemap or llms files; search kept | `noindex` |
| `searchable: false` | yes | sitemap and llms yes; site search no | `index, follow` |

Each page has exactly one robots meta tag. `noindex` does not add `nofollow`:
crawlers still follow the page's links to the pages that are indexed.

With `seo.robots.index: false`, robots.txt says `Disallow: /`, and no
`sitemap.xml` or `llms*.txt` is written (one left from an earlier build is
removed).

### Hidden pages

```markdown
---
title: Beta feature
hidden: true
---
```

A hidden page is built and reachable by its URL (share the link), but it is
not in the sidebar, the previous / next links or search, and not indexed.
In `content.docs.nav.mode: manual`, `hidden: true` on a group or tab hides
all its pages, and pages no group lists are hidden too
([Navigation](navigation.md#a-sidebar-you-list-mode-manual)).

A folder without an `index.md` is a sidebar section only, never a page: it
gets no route and no sitemap entry.

### Content signals

`seo.contentSignals` writes a [Content-Signal](https://contentsignals.org)
line into robots.txt, saying how crawlers may use the pages: `search`
(search results), `aiInput` (answers grounded on the page) and `aiTrain`
(model training). Keys you leave out are left out of the line; with no
`contentSignals` there is no line.

```text
User-agent: *
Allow: /
Content-Signal: search=yes, ai-input=yes, ai-train=no
```

## Page-level overrides

Use frontmatter on any markdown page:

```markdown
---
title: "Custom Page Title"
description: "Custom meta description for search snippets"
noindex: true    # keep it in the sidebar, out of search engines and site search
hidden: true     # keep it out of the sidebar too (see Hidden pages)
---

# Page Content
```

If `description` is omitted, the first paragraph is used automatically.

## Per-page HTML includes

Each route HTML file contains:

- `<link rel="canonical">` (absolute HTTPS)
- `<meta name="description">`
- Open Graph tags (`og:title`, `og:description`, `og:url`, `og:type`, `og:image`)
- Twitter Card tags
- JSON-LD `TechArticle` schema
- Static `<nav>` with links to every doc page (for non-JS crawlers)
- `<noscript>` pre-rendered page content

## Runtime (SPA navigation)

When users navigate via the sidebar, React updates title, canonical, OG, Twitter, robots, and JSON-LD to match the current page, with the same robots value and trailing-slash rule as the built HTML.

## Deploy

See [GitHub Pages](../getting-started/github-pages.md) for publishing the build. Submit your sitemap in [Google Search Console](https://search.google.com/search-console):

```
https://your-domain.com/sitemap.xml
```
