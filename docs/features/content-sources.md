# Content Sources

Configure where PraisonAIUI discovers your documentation content.

## Docs Directory

```yaml
content:
  docs:
    dir: "./docs"
```

## Include/Exclude Patterns

Control which files are processed:

```yaml
content:
  docs:
    dir: "./docs"
    include:
      - "**/*.md"
      - "**/*.mdx"
    exclude:
      - "**/drafts/**"
      - "_*.md"
```

## Index Files

Files treated as directory index:

```yaml
content:
  docs:
    indexFiles:
      - "index.md"
      - "README.md"
```

## Frontmatter

Control page metadata with YAML frontmatter:

```markdown
---
title: "Custom Title"
order: 1
---

# Page Content
```

### Supported Fields

| Field | Description |
|-------|-------------|
| `title` | Page title (overrides heading) |
| `order` | Sort order in navigation |
| `hidden` | Hide from navigation |
| `description` | SEO meta description |

## Numbered Prefixes

Files with numbered prefixes are auto-sorted:

```
docs/
├── 01-introduction.md   # order: 1
├── 02-installation.md   # order: 2
└── 03-quickstart.md     # order: 3
```

The prefix is stripped from the URL slug.
