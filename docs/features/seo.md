# SEO

Built-in SEO features for better search engine visibility.

## Automatic Meta Tags

PraisonAIUI generates meta tags from your configuration:

```yaml
site:
  title: "My Documentation"
  description: "Comprehensive guides for my product"
```

Generates:
```html
<title>My Documentation</title>
<meta name="description" content="Comprehensive guides for my product">
```

## Page-Level Overrides

Use frontmatter to override per-page:

```markdown
---
title: "Custom Page Title"
description: "Custom meta description for this page"
---

# Page Content
```

## SEO Configuration

```yaml
site:
  seo:
    titleTemplate: "%s | My Site"
    defaultImage: "/og-image.png"
    twitterHandle: "@myhandle"
```

## Open Graph

Automatic Open Graph tags for social sharing:

```html
<meta property="og:title" content="Page Title">
<meta property="og:description" content="Page description">
<meta property="og:image" content="/og-image.png">
<meta property="og:type" content="website">
```

## Sitemap

Generate a sitemap during build:

```bash
aiui build --sitemap
```

Creates `sitemap.xml` with all pages.

## Robots.txt

```yaml
site:
  seo:
    robots:
      index: true
      follow: true
```
