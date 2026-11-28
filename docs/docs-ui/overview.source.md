---
title: Docs UI Overview
nav_title: Overview
description: Turn a folder of Markdown files and one aiui.yaml into a fast, searchable documentation site with tabs, SEO, llms.txt and optional sign-in.
---

# Docs UI Overview

PraisonAIUI includes a complete static documentation builder. Write plain Markdown files, organize your menus in `aiui.yaml`, and generate a fast, searchable site — the exact site you are reading right now is built this way.

## Launch a docs site in 3 steps

<Steps>
<Step title="Initialize a project">
```bash
pip install aiui
aiui init --template docs
```

This creates `aiui.yaml` with site branding, theme, search and navigation defaults.
</Step>
<Step title="Add Markdown pages">
Create pages under `docs/` using standard Markdown plus built-in components like `<Steps>`, `<Tabs>`, `<CardGroup>`, `<Tip>` and Mermaid diagrams:

```markdown title="docs/index.md"
# Welcome to My Docs

Start exploring the guide below.
```
</Step>
<Step title="Preview and publish">
```bash
aiui dev              # Live preview with hot reload on http://127.0.0.1:8000/docs/
aiui build --strict   # Validate links, headings and config, then build static files
```

Deploy the built output to GitHub Pages, Cloudflare Pages, Netlify, or serve it with `aiui serve`.
</Step>
</Steps>

## What Docs UI gives you

| Feature | Why it helps | Guide |
|---------|--------------|-------|
| **Tabs, groups & icons** | Divide docs cleanly into top-level menus and nested sidebar groups | [Navigation](../features/navigation.md) |
| **Rich Markdown components** | Steps, tabs, cards, callouts, accordions, code highlights and Mermaid | [Writing docs](../features/writing-docs.md) |
| **Instant search & SEO** | Client-side search with tab filtering, OpenGraph tags and sitemap | [SEO](../features/seo.md) |
| **AI-ready output** | Automatic `llms.txt`, `llms-full.txt` and Markdown source endpoints | [AI-ready docs](../features/ai-ready-docs.md) |
| **API references** | Generate interactive docs from OpenAPI specs or Python docstrings | [OpenAPI](../features/openapi.md) |
| **Built-in sign-in** | Protect private docs or specific folders with a password in YAML | [Docs sign-in](../features/docs-auth.md) |

## Next steps

<CardGroup cols={2}>
<Card title="Writing docs" icon="file-text" href="../features/writing-docs.md">
Learn every frontmatter option, callout, tab, card and diagram block.
</Card>
<Card title="Navigation & menus" icon="compass" href="../features/navigation.md">
Configure top-level tabs, sidebar groups, dropdowns and badges.
</Card>
<Card title="Deploy to GitHub Pages" icon="globe" href="../getting-started/github-pages.md">
Publish automatically on every push to `main`.
</Card>
<Card title="Python & OpenAPI docs" icon="code" href="../features/api-reference-python.md">
Generate live API reference pages straight from your codebase.
</Card>
</CardGroup>
