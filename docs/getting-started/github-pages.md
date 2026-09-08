# Deploy to GitHub Pages

Ship your AIUI docs site to GitHub Pages with one workflow file.

## Quick Start

### 1. Project Structure

```
my-project/
├── aiui.template.yaml    # Site configuration
├── docs/                 # Your markdown content
│   ├── index.md
│   └── guide.md
├── CNAME                 # Custom domain (optional)
└── .github/
    └── workflows/
        └── deploy.yml    # GitHub Actions workflow
```

### 2. Configuration

Create `aiui.template.yaml`:

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
          aiui build --output site --minify
          # Preserve custom domain (if using one)
          [ -f CNAME ] && cp CNAME site/CNAME

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

## Custom Domain

To use a custom domain (e.g., `docs.example.com`):

1. Create a `CNAME` file in your repo root:
   ```
   docs.example.com
   ```
2. Configure DNS — add a CNAME record pointing to `<username>.github.io`
3. The workflow above automatically copies `CNAME` into the build output

## Migrating from MkDocs

Already using MkDocs? The migration is simple:

| MkDocs | AIUI |
|--------|------|
| `mkdocs.yml` | `aiui.template.yaml` |
| `mkdocs build` → `./site/` | `aiui build --output site` → `./site/` |
| `mkdocs serve` | `aiui serve` |
| `pip install mkdocs-material` | `pip install aiui` |

Your existing `docs/` folder works as-is — just swap the config and build command.

### Migration Steps

1. Create `aiui.template.yaml` (see example above)
2. Replace `mkdocs build` with `aiui build --output site --minify` in your CI workflow
3. Remove `mkdocs.yml` (optional — keep for reference)
4. Push to `main`

## Local Preview

Preview your site before deploying:

```bash
# Build and serve locally
aiui build
aiui serve

# Or use dev mode with hot reload
aiui dev
```

## Build Output

`aiui build --output site` produces:

```
site/
├── index.html           # SPA entry point
├── assets/              # JS + CSS bundles
│   ├── index.js
│   └── index.css
├── ui-config.json       # Site configuration manifest
├── docs-nav.json        # Navigation tree
├── route-manifest.json  # Route definitions
└── docs/                # Markdown content (copied)
    ├── index.md
    └── ...
```

Everything is static — no server required. GitHub Pages serves it directly.
