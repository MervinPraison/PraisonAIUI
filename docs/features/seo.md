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
    index: true
    follow: true
  twitter:
    handle: "@yourhandle"
```

`siteUrl` is needed for absolute canonical URLs, `sitemap.xml`, `llms.txt` and
`llms-full.txt`. Without it the build falls back to a `CNAME` file next to the
config (or in `docs/`), and without either those files are skipped.

## Build outputs

`aiui build` automatically generates:

| File | Purpose |
|------|---------|
| `sitemap.xml` | All doc URLs with `lastmod` dates |
| `robots.txt` | Crawl rules + sitemap pointer |
| `llms.txt` | AI crawler index ([llmstxt.org](https://llmstxt.org)) |
| `llms-full.txt` | Full markdown export for AI tools |
| `docs/**/*.html` | Per-route HTML with meta tags + crawl nav |
| `.nojekyll` | GitHub Pages Jekyll bypass |

No extra flags are needed: the files are written whenever `content.docs` is
configured (the site-URL ones only when a site URL is known, see above). Pages
with `noindex: true` are left out of the sitemap and the `llms` files.

## Page-level overrides

Use frontmatter on any markdown page:

```markdown
---
title: "Custom Page Title"
description: "Custom meta description for search snippets"
noindex: true
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

When users navigate via the sidebar, React updates title, canonical, OG, Twitter, robots, and JSON-LD to match the current page.

## Deploy

See [GitHub Pages](../getting-started/github-pages.md) for publishing the build. Submit your sitemap in [Google Search Console](https://search.google.com/search-console):

```
https://your-domain.com/sitemap.xml
```
