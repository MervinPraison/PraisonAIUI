# SEO

> Built-in SEO for documentation sites — sitemap, robots, llms.txt, per-page meta tags, and crawlable static HTML.

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
  ogImages: true         # a generated social card per page (needs Pillow); false: defaultImage
  contentSignals:        # optional robots.txt Content-Signal line
    search: true
    aiInput: true
    aiTrain: false
  twitter:
    handle: "@yourhandle"
  metatags:              # extra head tags on every page
    google-site-verification: "abc123"
    og:locale: en_GB
  paths:                 # head tags for the pages under a folder
    - path: v1           # or /docs/v1, v1/*; the longest matching path wins
      metatags:
        robots: noindex
  organization:          # the JSON-LD publisher (default: site title, siteUrl, logo)
    name: Acme Inc
    logo: /logo.svg
    sameAs: [https://github.com/acme]
```

Every key is optional; the defaults are what most sites want.

`siteUrl` is needed for absolute canonical URLs and `sitemap.xml`. Without it
the build falls back to a `CNAME` file next to the config (or in `docs/`), and
without either there is no sitemap and `llms.txt` / `llms-full.txt` use
root-relative links. What the build publishes for agents (agent-ready `.md`
pages, `llms.txt` by nav group, `markdown.instructions`):
[AI-ready docs](https://ui.praison.ai/docs/features/ai-ready-docs.md).

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
([Navigation](https://ui.praison.ai/docs/features/navigation.md#a-sidebar-you-list-mode-manual)).

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
Component and HTML tags are left out of it: a page that opens with
`<Note>` or a multi-line `<img>` gets its first sentence of prose.

Any Open Graph, Twitter or article tag, the canonical URL, the robots value
and keywords can be set per page (quote keys that have a colon):

```markdown
---
title: Install
canonical: https://example.com/original/install
robots: noindex, nofollow
keywords: [install, setup]
'og:image': /images/install-card.png
'twitter:card': summary
---
```

Each tag is decided once, in this order (later wins): the built defaults,
`seo.metatags`, `seo.paths` (shorter paths first), the page's frontmatter.
Then `og:url` follows the canonical and `twitter:image` the `og:image`
(unless set themselves), and `twitter:card` is `summary_large_image` when the
page has an image. Root-relative URLs (`/images/x.png`) become absolute.
A noindex page keeps `noindex` whatever the overrides say, and a `robots`
value with `noindex` (from frontmatter or a `seo.paths` folder) also leaves
the page out of the sitemap, `llms.txt` and search, so they never disagree.
Open Graph keys (`og:`, `article:`) are written as `property=`, the rest as
`name=`; every value is HTML-escaped. `aiui validate` rejects a
`seo.metatags` key that is not a tag name.

## Social cards

Install Pillow and every docs page gets its own share image, with no config:

```bash
pip install pillow
aiui build
```

The build draws a 1200x630 PNG per page and publishes it at
`/og/<page route>.png` (`/og/docs/guide/install.png`). Each card shows the
page title (sized to fit, up to three lines), its sidebar group, as much of
the description as fits, the site name with its logo and the site's host,
in the theme's accent and colour mode (`site.theme.preset`, `accent`,
`accentDark`, `mode`; preset `paper` gets the paper colours). A PNG, JPEG,
WebP or GIF `logo` is drawn as is; an SVG or emoji logo becomes the site's
initial on an accent tile. Latin text uses the UI's own font; other scripts
use a system font (Noto Sans CJK, Arial Unicode, Noto Sans or DejaVu Sans).

The card becomes the page's `og:image` and `twitter:image`, with a
`summary_large_image` card, in the built HTML and when the docs app moves
between pages, and the site root shares the docs home's card.

Which image a page gets, first match wins:

| Set by | Image |
|--------|-------|
| `'og:image'` in the page's frontmatter or a `seo.paths` folder | that image, no card drawn |
| `og:image` in `seo.metatags` | that image on every page, no cards drawn |
| `seo.ogImages: false`, or Pillow not installed | `seo.defaultImage` |
| otherwise | the page's generated card |

Cards are cached by a hash of what they show (in `$AIUI_DATA_DIR/og-cards`,
else `~/.praisonaiui/cache/og-cards`), so `aiui dev` and repeat builds only
draw the pages that changed, and new cards are drawn in parallel. Without
Pillow, `aiui build` prints one note saying how to turn them on.

## Per-page HTML includes

Each route HTML file contains:

- `<link rel="canonical">` (absolute HTTPS)
- `<meta name="description">`
- Open Graph tags (`og:title`, `og:description`, `og:url`, `og:type`, `og:site_name`, `og:image`: the page's [social card](#social-cards) by default), each once
- Twitter Card tags (`summary_large_image` with an image)
- Your `seo.metatags`, `seo.paths` and frontmatter tags
- One JSON-LD `@graph`: `Organization`, `WebSite` (with a `SearchAction`: `?q=` opens site search),
  `TechArticle` (publisher, `dateModified` with `content.docs.lastUpdated`, keywords, image) and a
  `BreadcrumbList` from the sidebar groups
- Static `<nav>` with links to every doc page (for non-JS crawlers)
- `<noscript>` pre-rendered page content

## Runtime (SPA navigation)

When users navigate via the sidebar, React updates title, canonical, OG, Twitter, robots, and JSON-LD to match the current page, with the same tags, overrides and order as the built HTML (`docs-nav.json` carries each page's `seo` map). The built page's JSON-LD graph stays while it is the page shown.

## Deploy

See [GitHub Pages](https://ui.praison.ai/docs/getting-started/github-pages.md) for publishing the build. Submit your sitemap in [Google Search Console](https://search.google.com/search-console):

```
https://your-domain.com/sitemap.xml
```

## Related pages

- [Content Sources](https://ui.praison.ai/docs/features/content-sources.md)
- [AI-ready docs](https://ui.praison.ai/docs/features/ai-ready-docs.md)
- [Navigation](https://ui.praison.ai/docs/features/navigation.md)
