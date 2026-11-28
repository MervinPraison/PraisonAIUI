# Docs UI Overview

> Turn a folder of Markdown files and one aiui.yaml into a fast, searchable documentation site with tabs, SEO, llms.txt and optional sign-in.

PraisonAIUI includes a complete static documentation builder. Write plain Markdown files, organize your menus in `aiui.yaml`, and generate a fast, searchable site — the exact site you are reading right now is built this way.

## Launch a docs site in 3 steps

1. **Initialize a project**

   ```bash
   pip install aiui
   aiui init --template docs
   ```

   This creates `aiui.yaml` with site branding, theme, search and navigation defaults.

2. **Add Markdown pages**

   Create pages under `docs/` using standard Markdown plus built-in components like `<Steps>`, `<Tabs>`, `<CardGroup>`, `<Tip>` and Mermaid diagrams:

   ```markdown title="docs/index.md"
   # Welcome to My Docs

   Start exploring the guide below.
   ```

3. **Preview and publish**

   ```bash
   aiui dev              # Live preview with hot reload on http://127.0.0.1:8000/docs/
   aiui build --strict   # Validate links, headings and config, then build static files
   ```

   Deploy the built output to GitHub Pages, Cloudflare Pages, Netlify, or serve it with `aiui serve`.

## What Docs UI gives you

| Feature | Why it helps | Guide |
|---------|--------------|-------|
| **Tabs, groups & icons** | Divide docs cleanly into top-level menus and nested sidebar groups | [Navigation](https://ui.praison.ai/docs/features/navigation.md) |
| **Rich Markdown components** | Steps, tabs, cards, callouts, accordions, code highlights and Mermaid | [Writing docs](https://ui.praison.ai/docs/features/writing-docs.md) |
| **Instant search & SEO** | Client-side search with tab filtering, OpenGraph tags and sitemap | [SEO](https://ui.praison.ai/docs/features/seo.md) |
| **AI-ready output** | Automatic `llms.txt`, `llms-full.txt` and Markdown source endpoints | [AI-ready docs](https://ui.praison.ai/docs/features/ai-ready-docs.md) |
| **API references** | Generate interactive docs from OpenAPI specs or Python docstrings | [OpenAPI](https://ui.praison.ai/docs/features/openapi.md) |
| **Built-in sign-in** | Protect private docs or specific folders with a password in YAML | [Docs sign-in](https://ui.praison.ai/docs/features/docs-auth.md) |

## Next steps

- [Writing docs](https://ui.praison.ai/docs/features/writing-docs.md)
  Learn every frontmatter option, callout, tab, card and diagram block.
- [Navigation & menus](https://ui.praison.ai/docs/features/navigation.md)
  Configure top-level tabs, sidebar groups, dropdowns and badges.
- [Deploy to GitHub Pages](https://ui.praison.ai/docs/getting-started/github-pages.md)
  Publish automatically on every push to `main`.
- [Python & OpenAPI docs](https://ui.praison.ai/docs/features/api-reference-python.md)
  Generate live API reference pages straight from your codebase.

## Related pages

- [Quick Start](https://ui.praison.ai/docs/getting-started/quickstart.md)
- [SEO](https://ui.praison.ai/docs/features/seo.md)
- [Docs sign-in](https://ui.praison.ai/docs/features/docs-auth.md)
